
require('dotenv').config();
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');
http.createServer((req,res)=>{res.writeHead(200);res.end('Blackout 404 Card Bot');}).listen(process.env.PORT||10000);

const ANNOUNCE_CHANNEL_ID = "1552037988429729832";
const MILESTONE_MINUTES = 1;
const TEMPLATE_PATH = './template.jpg';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

let db={users:{}};
const DB_FILE='./database.json';
function loadDB(){ if(fs.existsSync(DB_FILE)){ try{ db=JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }catch(e){} } }
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
loadDB();
function getUserData(uid){
  if(!db.users[uid]) db.users[uid]={points:0,totalMinutes:0,messages:0,level:1,announced1m:false};
  if(db.users[uid].messages===undefined) db.users[uid].messages=0;
  if(db.users[uid].level===undefined) db.users[uid].level=1;
  if(db.users[uid].announced1m===undefined) db.users[uid].announced1m=false;
  return db.users[uid];
}
const voiceSessions=new Map();

// ORA CONTA TUTTI I VOCALI DEL TUO DISCORD
function isInAllowedCategory(channel){
  if(!channel) return false;
  return true; // tutti i vocali
}

async function generateCard(user, stats){
  const Jimp = require('jimp');
  const template = await Jimp.read(TEMPLATE_PATH);
  const w = template.getWidth();
  const h = template.getHeight();
  
  // Avatar circolare in alto a sinistra o dentro
  try{
    const avatarURL = user.displayAvatarURL({extension:'png', size:512, forceStatic:true});
    let avatar = await Jimp.read(avatarURL);
    const avatarSize = Math.floor(w * 0.12);
    avatar.resize(avatarSize, avatarSize);
    // cerchio
    avatar.circle();
    // posiziona in alto al centro della card? Mettiamo vicino al LEVEL UP
    // Coordinate per mettere avatar sopra la console
    template.composite(avatar, Math.floor(w*0.05), Math.floor(h*0.18));
  }catch(e){ console.error('Avatar fail', e); }

  // Scrivi username e level
  try{
    const fontWhite = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const fontBig = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
    const fontCyan = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    
    // Tag persona
    const tagText = `@${user.username}`;
    // livello
    const oldLevel = Math.max(1, (stats.level||1)-1);
    const newLevel = stats.level||1;
    
    // Pulisci area testo in basso con rettangolo scuro
    // Area @username
    const textX = Math.floor(w*0.15);
    const textY = Math.floor(h*0.915);
    template.print(fontWhite, textX, textY, tagText);
    
    // Level center
    const levelText = `${oldLevel} > ${newLevel}`;
    template.print(fontBig, Math.floor(w*0.47), Math.floor(h*0.905), levelText);
    
  }catch(e){ console.error('Text fail', e); }

  return await template.getBufferAsync(Jimp.MIME_PNG);
}

async function checkAndAnnounce1min(userId, guild){
  const data=getUserData(userId);
  if(data.announced1m) return;
  if(data.totalMinutes>=MILESTONE_MINUTES){
    data.announced1m=true; 
    data.level = Math.floor(data.totalMinutes/10)+1;
    saveDB();
    try{
      const channel=guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);
      if(!channel) return;
      const member=guild.members.cache.get(userId);
      const user = member?member.user:await client.users.fetch(userId);
      const buffer=await generateCard(user,{level:data.level, voiceTime:data.totalMinutes, messages:data.messages, points:data.points});
      const attachment=new AttachmentBuilder(buffer,{name:`blackout-${user.username}.png`});
      const embed=new EmbedBuilder()
        .setColor(0x00ffff)
        .setTitle(`⚡ BLACKOUT 404 - LEVEL UP!`)
        .setDescription(`<@${userId}> ha raggiunto il **livello ${data.level}**! **${Math.floor(data.totalMinutes)} min** in vocale`)
        .setImage(`attachment://blackout-${user.username}.png`)
        .setTimestamp();
      await channel.send({content:`🎉 <@${userId}> LEVEL UP!`, embeds:[embed], files:[attachment]});
      console.log(`[BLACKOUT CARD] ${userId} level ${data.level}`);
    }catch(e){ console.error(e); }
  }
}

client.on(Events.VoiceStateUpdate,(oldState,newState)=>{
  const userId=newState.id||oldState.id;
  if(userId===client.user.id) return;
  const had=!!oldState.channel, has=!!newState.channel;
  const guild=newState.guild||oldState.guild;
  if(!had&&has){ voiceSessions.set(userId, Date.now()); console.log(`[JOIN ALL] ${userId} in ${newState.channel?.name}`); }
  if(had&&!has){
    const jt=voiceSessions.get(userId);
    if(jt){ const diff=(Date.now()-jt)/1000/60; const data=getUserData(userId); data.totalMinutes+=diff; data.points=Math.floor(data.totalMinutes)+(data.messages||0); data.level=Math.floor(data.totalMinutes/10)+1; saveDB(); voiceSessions.delete(userId); checkAndAnnounce1min(userId, guild); }
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
  console.log(`✅ BLACKOUT 404 Bot online ${client.user.tag} - TUTTI I VOCALI`);
  for(const guild of client.guilds.cache.values()){ for(const [mid,vs] of guild.voiceStates.cache){ if(vs.channel&&mid!==client.user.id){ voiceSessions.set(mid, Date.now()); } } }
  const commands=[ new SlashCommandBuilder().setName('punti').setDescription('Vedi punti Blackout'), new SlashCommandBuilder().setName('classifica').setDescription('Top 10 Blackout'), new SlashCommandBuilder().setName('card').setDescription('Genera Blackout card') ].map(c=>c.toJSON());
  const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
  try{ await rest.put(Routes.applicationCommands(client.user.id),{body:commands}); console.log('✅ Slash'); }catch(e){ console.error(e); }
});

client.on(Events.InteractionCreate, async i=>{
  if(!i.isChatInputCommand()) return;
  if(i.commandName==='punti'){ const data=db.users[i.user.id]||{points:0,totalMinutes:0,messages:0,level:1}; const embed=new EmbedBuilder().setColor(0x00ffff).setTitle('⚡ Blackout 404 - Punti').setDescription(`**${data.points} punti** | Lv ${data.level} | ${data.totalMinutes.toFixed(1)} min | ${data.messages||0} msg`).setThumbnail(i.user.displayAvatarURL()); await i.reply({embeds:[embed]}); }
  if(i.commandName==='classifica'){ const sorted=Object.entries(db.users).sort((a,b)=>b[1].points-a[1].points).slice(0,10); if(sorted.length===0) return i.reply('Nessuno!'); let desc=''; for(let k=0;k<sorted.length;k++){ const [uid,val]=sorted[k]; desc+=`**${k+1}.** <@${uid}> - Lv ${val.level||1} - ${val.points} punti\n`; } const embed=new EmbedBuilder().setColor(0x00ffff).setTitle('🏆 Classifica Blackout 404').setDescription(desc); await i.reply({embeds:[embed]}); }
  if(i.commandName==='card'){ await i.deferReply(); const data=getUserData(i.user.id); try{ const buffer=await generateCard(i.user,{level:data.level, voiceTime:data.totalMinutes, messages:data.messages, points:data.points}); const att=new AttachmentBuilder(buffer,{name:`blackout-${i.user.username}.png`}); const embed=new EmbedBuilder().setColor(0x00ffff).setTitle(`${i.user.username} - BLACKOUT CARD`).setImage(`attachment://blackout-${i.user.username}.png`); await i.editReply({embeds:[embed], files:[att]}); }catch(e){ console.error(e); await i.editReply('Errore card: '+e.message); } }
});

client.login(process.env.DISCORD_TOKEN);
