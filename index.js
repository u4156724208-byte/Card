
require('dotenv').config();
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');
http.createServer((req,res)=>{res.writeHead(200);res.end('Blackout 404 LIGHT');}).listen(process.env.PORT||10000);

const ANNOUNCE_CHANNEL_ID = "1552037988429729832";
const MILESTONE_MINUTES = 1;
const TEMPLATE_PATH = './template.jpg';
const Jimp = require('jimp');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

let db={users:{}};
const DB_FILE='./database.json';
function loadDB(){ if(fs.existsSync(DB_FILE)){ try{ db=JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }catch(e){} } }
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
loadDB();
function getUserData(uid){
  if(!db.users[uid]) db.users[uid]={points:0,totalMinutes:0,messages:0,announced1m:false};
  if(db.users[uid].messages===undefined) db.users[uid].messages=0;
  if(db.users[uid].announced1m===undefined) db.users[uid].announced1m=false;
  return db.users[uid];
}
const voiceSessions=new Map();

function isInAllowedCategory(channel){
  if(!channel) return false;
  const parent = channel.parent;
  const parentName = parent ? parent.name.toLowerCase() : '';
  const chName = channel.name ? channel.name.toLowerCase() : '';
  const keywords=['raiders','ricerca raiders'];
  for(const k of keywords){ if(parentName.includes(k)||chName.includes(k)) return true; }
  return false;
}

async function generateCard(user, stats){
  const template = await Jimp.read(TEMPLATE_PATH);
  const w = template.getWidth();
  const h = template.getHeight();
  // area blu: 0.627-0.933 x , 0.21-0.62 y circa (usa v12 senza arcobaleno)
  const bx = Math.floor(w*0.627);
  const by = Math.floor(h*0.21);
  const bw = Math.floor(w*0.31);
  const bh = Math.floor(h*0.41);
  try{
    const avatarURL = user.displayAvatarURL({extension:'png', size:512});
    const avatar = await Jimp.read(avatarURL);
    avatar.resize(bw-8, bh-8);
    template.composite(avatar, bx+4, by+4);
  }catch(e){ console.error('Avatar fail', e); }

  // stats testuali overlay sotto
  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
  const fontYellow = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
  // scrivi stats in basso
  const statsText = `${Math.floor(stats.voiceTime)}m | ${stats.messages} msgs | ${stats.points} pts`;
  // non serve scrivere complesso, la card base ha gia testi placeholder, lasciamo solo overlay piccolo in alto
  return await template.getBufferAsync(Jimp.MIME_PNG);
}

async function checkAndAnnounce1min(userId, guild){
  const data=getUserData(userId);
  if(data.announced1m) return;
  if(data.totalMinutes>=MILESTONE_MINUTES){
    data.announced1m=true; saveDB();
    try{
      const channel=guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);
      if(!channel) return;
      const member=guild.members.cache.get(userId);
      const user = member?member.user:await client.users.fetch(userId);
      const buffer=await generateCard(user,{voiceTime:data.totalMinutes,messages:data.messages,points:data.points});
      const attachment=new AttachmentBuilder(buffer,{name:`card-${user.username}.png`});
      const embed=new EmbedBuilder().setColor(0x8a2be2).setTitle(`🎉 ARC RAIDERS - 1 MINUTO!`).setDescription(`<@${userId}> ha sbloccato la Collector Card! **${Math.floor(data.totalMinutes)} min**`).setImage(`attachment://card-${user.username}.png`).setTimestamp();
      await channel.send({content:`🎊 <@${userId}> - COLLECTOR CARD!`, embeds:[embed], files:[attachment]});
      console.log(`[CARD 1m] ${userId}`);
    }catch(e){ console.error(e); }
  }
}

client.on(Events.VoiceStateUpdate,(oldState,newState)=>{
  const userId=newState.id||oldState.id;
  if(userId===client.user.id) return;
  const had=!!oldState.channel, has=!!newState.channel;
  const guild=newState.guild||oldState.guild;
  const inJoin=has&&isInAllowedCategory(newState.channel);
  const inLeave=had&&isInAllowedCategory(oldState.channel);
  if(!had&&has&&inJoin){ voiceSessions.set(userId, Date.now()); console.log(`[JOIN] ${userId}`); }
  if(had&&!has&&inLeave){
    const jt=voiceSessions.get(userId);
    if(jt){ const diff=(Date.now()-jt)/1000/60; const data=getUserData(userId); data.totalMinutes+=diff; data.points=Math.floor(data.totalMinutes)+(data.messages||0); saveDB(); voiceSessions.delete(userId); checkAndAnnounce1min(userId, guild); }
  }
});

setInterval(async()=>{
  const guild=client.guilds.cache.first(); if(!guild) return;
  for(const [uid,jt] of voiceSessions.entries()){
    const data=getUserData(uid); data.totalMinutes+=0.25; data.points=Math.floor(data.totalMinutes)+(data.messages||0); await checkAndAnnounce1min(uid, guild);
  }
  saveDB();
},15*1000);

client.on(Events.MessageCreate, async(m)=>{
  if(m.author.bot||!m.guild||m.content.trim().length===0) return;
  if(!isInAllowedCategory(m.channel)) return;
  const data=getUserData(m.author.id); data.messages+=1; data.points=Math.floor(data.totalMinutes)+data.messages; saveDB();
});

client.once(Events.ClientReady, async()=>{
  console.log(`✅ LIGHT Bot online ${client.user.tag}`);
  for(const guild of client.guilds.cache.values()){ for(const [mid,vs] of guild.voiceStates.cache){ if(vs.channel&&mid!==client.user.id&&isInAllowedCategory(vs.channel)){ voiceSessions.set(mid, Date.now()); } } }
  const commands=[ new SlashCommandBuilder().setName('punti').setDescription('Vedi punti'), new SlashCommandBuilder().setName('classifica').setDescription('Top 10'), new SlashCommandBuilder().setName('card').setDescription('Genera card') ].map(c=>c.toJSON());
  const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
  try{ await rest.put(Routes.applicationCommands(client.user.id),{body:commands}); console.log('✅ Slash'); }catch(e){ console.error(e); }
});

client.on(Events.InteractionCreate, async i=>{
  if(!i.isChatInputCommand()) return;
  if(i.commandName==='punti'){ const data=db.users[i.user.id]||{points:0,totalMinutes:0,messages:0}; const embed=new EmbedBuilder().setColor(0x8a2be2).setTitle('Raiders - Punti').setDescription(`**${data.points} punti** | ${data.totalMinutes.toFixed(1)} min | ${data.messages||0} msg`).setThumbnail(i.user.displayAvatarURL()); await i.reply({embeds:[embed]}); }
  if(i.commandName==='classifica'){ const sorted=Object.entries(db.users).sort((a,b)=>b[1].points-a[1].points).slice(0,10); if(sorted.length===0) return i.reply('Nessuno!'); let desc=''; for(let k=0;k<sorted.length;k++){ const [uid,val]=sorted[k]; desc+=`**${k+1}.** <@${uid}> - ${val.points} punti\n`; } const embed=new EmbedBuilder().setColor(0x8a2be2).setTitle('🏆 Classifica Raiders').setDescription(desc); await i.reply({embeds:[embed]}); }
  if(i.commandName==='card'){ await i.deferReply(); const data=getUserData(i.user.id); try{ const buffer=await generateCard(i.user,{voiceTime:data.totalMinutes,messages:data.messages,points:data.points}); const att=new AttachmentBuilder(buffer,{name:`card-${i.user.username}.png`}); const embed=new EmbedBuilder().setColor(0x8a2be2).setTitle(`${i.user.username} - CARD`).setImage(`attachment://card-${i.user.username}.png`); await i.editReply({embeds:[embed], files:[att]}); }catch(e){ console.error(e); await i.editReply('Errore card'); } }
});

client.login(process.env.DISCORD_TOKEN);
