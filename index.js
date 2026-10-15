
console.log("[BOOT] BLACKOUT START - " + new Date().toISOString());
console.log("[BOOT] Node version " + process.version);
console.log("[BOOT] Token exists: " + (!!process.env.DISCORD_TOKEN) + " len=" + (process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.length : 0));
try {
  const fs = require('fs');
  console.log("[BOOT] Files in dir: " + fs.readdirSync('.').join(', '));
  if (fs.existsSync('./template.jpg')) {
    const stat = fs.statSync('./template.jpg');
    console.log("[BOOT] template.jpg OK size=" + stat.size);
  } else {
    console.log("[BOOT] template.jpg MISSING - will create fallback");
  }
} catch(e){ console.log("[BOOT] fs check error " + e.message); }

require('dotenv').config();
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');
http.createServer((req,res)=>{res.writeHead(200);res.end('Blackout 404 Bot OK');}).listen(process.env.PORT||10000);
console.log("[BOOT] HTTP server starting on port " + (process.env.PORT||10000));

const ANNOUNCE_CHANNEL_ID = "1552037988429729832";
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

let db={users:{}};
const DB_FILE='./database.json';
function loadDB(){ if(fs.existsSync(DB_FILE)){ try{ db=JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }catch(e){} } }
function saveDB(){ try{ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }catch(e){} }
loadDB();
function getUserData(uid){
  if(!db.users[uid]) db.users[uid]={points:0,totalMinutes:0,messages:0,level:1,announced1m:false};
  if(db.users[uid].messages===undefined) db.users[uid].messages=0;
  if(db.users[uid].level===undefined) db.users[uid].level=1;
  if(db.users[uid].announced1m===undefined) db.users[uid].announced1m=false;
  return db.users[uid];
}
const voiceSessions=new Map();

async function generateCard(user, stats){
  const Jimp = require('jimp');
  let template;
  try {
    if (fs.existsSync('./template.jpg')) {
      template = await Jimp.read('./template.jpg');
    } else {
      // fallback purple card
      template = new Jimp(1200, 675, 0x1a0033ff);
    }
  } catch(e){
    console.log("[CARD] Template read error " + e.message + " using fallback");
    template = new Jimp(1200, 675, 0x1a0033ff);
  }
  const w = template.getWidth();
  const h = template.getHeight();
  try{
    const avatarURL = user.displayAvatarURL({extension:'png', size:256, forceStatic:true});
    let avatar = await Jimp.read(avatarURL);
    const avatarSize = Math.floor(w * 0.12);
    avatar.resize(avatarSize, avatarSize);
    avatar.circle();
    template.composite(avatar, Math.floor(w*0.05), Math.floor(h*0.18));
  }catch(e){ console.log("[CARD] Avatar fail " + e.message); }
  try{
    const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const fontBig = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
    const tagText = "@" + user.username;
    const oldLevel = Math.max(1, (stats.level||1)-1);
    const newLevel = stats.level||1;
    template.print(font, Math.floor(w*0.15), Math.floor(h*0.915), tagText);
    template.print(fontBig, Math.floor(w*0.47), Math.floor(h*0.905), oldLevel + " > " + newLevel);
  }catch(e){ console.log("[CARD] Text fail " + e.message); }
  return await template.getBufferAsync(Jimp.MIME_PNG);
}

async function checkAndAnnounce1min(userId, guild){
  const data=getUserData(userId);
  if(data.announced1m) return;
  if(data.totalMinutes>=1){
    data.announced1m=true; 
    data.level = Math.floor(data.totalMinutes/10)+1;
    saveDB();
    console.log("[ANNOUNCE] Trying to announce " + userId + " level " + data.level);
    try{
      let channel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);
      if(!channel){ try{ channel = await guild.channels.fetch(ANNOUNCE_CHANNEL_ID); }catch(e){} }
      if(!channel){ console.log("[ANNOUNCE] Channel not found " + ANNOUNCE_CHANNEL_ID); return; }
      const member=guild.members.cache.get(userId);
      const user = member?member.user:await client.users.fetch(userId);
      const buffer=await generateCard(user,{level:data.level});
      const attachment=new AttachmentBuilder(buffer,{name:"blackout-"+user.username+".png"});
      const embed=new EmbedBuilder().setColor(0x00ffff).setTitle("⚡ BLACKOUT 404 - LEVEL UP!").setDescription("<@"+userId+"> ha raggiunto il **livello "+data.level+"**! **"+Math.floor(data.totalMinutes)+" min** in vocale").setImage("attachment://blackout-"+user.username+".png").setTimestamp();
      await channel.send({content:"🎉 <@"+userId+"> LEVEL UP!", embeds:[embed], files:[attachment]});
      console.log("[ANNOUNCE] Sent card for " + userId);
    }catch(e){ console.log("[ANNOUNCE] Error " + e.message); console.error(e); }
  }
}

client.on(Events.VoiceStateUpdate,(oldState,newState)=>{
  const userId=newState.id||oldState.id;
  if(userId===client.user.id) return;
  const had=!!oldState.channel, has=!!newState.channel;
  const guild=newState.guild||oldState.guild;
  console.log("[VOICE] " + userId + " had=" + had + " has=" + has + " channel=" + (newState.channel?newState.channel.name:"none"));
  if(!had&&has){ voiceSessions.set(userId, Date.now()); console.log("[VOICE] JOIN " + userId); }
  if(had&&!has){
    const jt=voiceSessions.get(userId);
    if(jt){ const diff=(Date.now()-jt)/1000/60; const data=getUserData(userId); data.totalMinutes+=diff; data.points=Math.floor(data.totalMinutes)+(data.messages||0); data.level=Math.floor(data.totalMinutes/10)+1; saveDB(); voiceSessions.delete(userId); console.log("[VOICE] LEAVE " + userId + " diff " + diff.toFixed(2)); checkAndAnnounce1min(userId, guild); }
  }
});

setInterval(async()=>{
  const guild=client.guilds.cache.first(); if(!guild) return;
  for(const [uid,jt] of voiceSessions.entries()){
    const data=getUserData(uid); data.totalMinutes+=0.25; data.points=Math.floor(data.totalMinutes)+(data.messages||0); data.level=Math.floor(data.totalMinutes/10)+1; await checkAndAnnounce1min(uid, guild);
  }
  saveDB();
},15*1000);

client.on(Events.MessageCreate, async(m)=>{
  if(m.author.bot||!m.guild||m.content.trim().length===0) return;
  const data=getUserData(m.author.id); data.messages+=1; data.points=Math.floor(data.totalMinutes)+data.messages; data.level=Math.floor(data.totalMinutes/10)+1; saveDB();
});

client.once(Events.ClientReady, async()=>{
  console.log("[LOGIN] ✅ BLACKOUT 404 Bot online " + client.user.tag + " - TUTTI I VOCALI");
  console.log("[LOGIN] Guilds: " + client.guilds.cache.size);
  for(const guild of client.guilds.cache.values()){ console.log("[LOGIN] Guild " + guild.name + " members " + guild.memberCount); for(const [mid,vs] of guild.voiceStates.cache){ if(vs.channel&&mid!==client.user.id){ voiceSessions.set(mid, Date.now()); console.log("[LOGIN] Found already in voice " + mid); } } }
  const commands=[ new SlashCommandBuilder().setName('punti').setDescription('Vedi punti Blackout'), new SlashCommandBuilder().setName('classifica').setDescription('Top 10 Blackout'), new SlashCommandBuilder().setName('card').setDescription('Genera Blackout card') ].map(c=>c.toJSON());
  const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
  try{ await rest.put(Routes.applicationCommands(client.user.id),{body:commands}); console.log('[LOGIN] ✅ Slash commands registered'); }catch(e){ console.log('[LOGIN] Slash error ' + e.message); }
});

client.on('error', (e)=>{ console.log("[ERROR] Client error " + e.message); });
client.on('shardError', (e)=>{ console.log("[ERROR] Shard error " + e.message); });

console.log("[LOGIN] Attempting login...");
client.login(process.env.DISCORD_TOKEN).then(()=>{ console.log("[LOGIN] Login promise resolved"); }).catch(e=>{ console.log("[LOGIN] Login failed " + e.message); console.error(e); });
