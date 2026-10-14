
require('dotenv').config();
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');
const { createCanvas, loadImage } = require('canvas');
http.createServer((req, res) => { res.writeHead(200); res.end('Blackout 404 Card Bot'); }).listen(process.env.PORT || 10000);

const ALLOWED_CATEGORY_NAME = "Arc Raiders";
const ANNOUNCE_CHANNEL_ID = "1552037988429729832";
const MILESTONE_MINUTES = 5;

const TEMPLATE_PATH = './template.jpg';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

let db = { users: {} };
const DB_FILE = './database.json';
function loadDB(){ if(fs.existsSync(DB_FILE)){ try{ db=JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }catch(e){} } }
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
loadDB();
function getUserData(uid){
  if(!db.users[uid]) db.users[uid]={points:0,totalMinutes:0,messages:0,announced5m:false};
  if(db.users[uid].messages===undefined) db.users[uid].messages=0;
  if(db.users[uid].announced5m===undefined) db.users[uid].announced5m=false;
  return db.users[uid];
}
const voiceSessions = new Map();

function isInAllowedCategory(channel){
  if(!channel) return false;
  const parent = channel.parent;
  const parentName = parent ? parent.name : null;
  if(parentName && parentName.toLowerCase().includes(ALLOWED_CATEGORY_NAME.toLowerCase())) return true;
  if(channel.name && channel.name.toLowerCase().includes(ALLOWED_CATEGORY_NAME.toLowerCase())) return true;
  return false;
}

async function generateCard(user, stats){
  // Carica template
  const template = await loadImage(TEMPLATE_PATH);
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(template, 0, 0);

  // Coordinate area blu (527,208 - 721,564 su 1000 scala)
  const bx = Math.floor(template.width * 0.527);
  const by = Math.floor(template.height * 0.210);
  const bw = Math.floor(template.width * (0.721-0.527));
  const bh = Math.floor(template.height * (0.564-0.210));

  try{
    const avatarURL = user.displayAvatarURL({ extension: 'png', size: 512 });
    const avatar = await loadImage(avatarURL);
    // Ritaglia quadrato centrale e disegna
    ctx.save();
    // Leggero arrotondamento per integrarsi nel metallo
    ctx.beginPath();
    ctx.rect(bx+4, by+4, bw-8, bh-8);
    ctx.clip();
    ctx.drawImage(avatar, bx+4, by+4, bw-8, bh-8);
    ctx.restore();

    // Overlay scuro per far risaltare e bordo interno
    ctx.strokeStyle = '#1a2a4a';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx+4, by+4, bw-8, bh-8);
  }catch(e){ console.error('Avatar load fail', e); }

  // Scrivi stats dinamiche sopra RAIDER STATS (sovrascrive numeri esistenti con rettangolo grigio)
  const statsY = Math.floor(template.height * 0.585);
  const statsX = Math.floor(template.width * 0.476);
  const statsW = Math.floor(template.width * 0.29);
  const statsH = Math.floor(template.height * 0.185);

  // Pulisci area stats per riscrivere
  ctx.fillStyle = '#2f3336';
  ctx.fillRect(statsX+5, statsY+35, statsW-10, statsH-35);

  ctx.fillStyle = '#e0e0e0';
  ctx.font = `bold ${Math.floor(template.height*0.028)}px sans-serif`;
  ctx.fillText(`VOICE TIME  ${Math.floor(stats.voiceTime)} min`, statsX+15, statsY+65);
  ctx.fillStyle = '#ffcc00';
  ctx.fillText(`${stats.messages} msgs`, statsX+15, statsY+105);
  ctx.fillStyle = '#a0a0a0';
  ctx.font = `${Math.floor(template.height*0.018)}px sans-serif`;
  ctx.fillText(`POINTS: ${stats.points} - ACTIVE`, statsX+15, statsY+135);

  return canvas.toBuffer('image/png');
}

async function checkAndAnnounce5min(userId, guild){
  const data = getUserData(userId);
  if(data.announced5m) return;
  if(data.totalMinutes >= MILESTONE_MINUTES){
    data.announced5m = true;
    saveDB();
    try{
      const channel = guild.channels.cache.get(ANNOUNCE_CHANNEL_ID);
      if(!channel){ console.log('Canale annuncio non trovato'); return; }
      const member = guild.members.cache.get(userId);
      const user = member ? member.user : await client.users.fetch(userId);
      
      const buffer = await generateCard(user, {
        voiceTime: data.totalMinutes,
        messages: data.messages,
        points: data.points
      });

      const attachment = new AttachmentBuilder(buffer, { name: `card-${user.username}.png` });
      
      const embed = new EmbedBuilder()
        .setColor(0x8a2be2)
        .setTitle(`🎉 ARC RAIDERS FAN CLUB - 5 MINUTI!`)
        .setDescription(`<@${userId}> ha raggiunto **${MILESTONE_MINUTES} minuti** in party in **${ALLOWED_CATEGORY_NAME}**!\nEcco la sua Collector Card ufficiale! 🔥\n**${Math.floor(data.totalMinutes)} min** | **${data.points} punti**`)
        .setImage(`attachment://card-${user.username}.png`)
        .setTimestamp();

      await channel.send({ content: `🎊 <@${userId}> - COLLECTOR CARD SBLOCCATA!`, embeds: [embed], files: [attachment] });
      console.log(`[ANNOUNCE CARD] ${userId} - card inviata`);
    }catch(e){ console.error('Announce error', e); }
  }
}

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const userId = newState.id || oldState.id;
  if (userId === client.user.id) return;
  const hadChannel = !!oldState.channel;
  const hasChannel = !!newState.channel;
  const guild = newState.guild || oldState.guild;
  const inAllowedOnJoin = hasChannel && isInAllowedCategory(newState.channel);
  const inAllowedOnLeave = hadChannel && isInAllowedCategory(oldState.channel);

  if (!hadChannel && hasChannel && inAllowedOnJoin) {
    voiceSessions.set(userId, Date.now());
    console.log(`[JOIN-ARC] ${userId}`);
  }
  if (hadChannel && !hasChannel && inAllowedOnLeave) {
    const joinTime = voiceSessions.get(userId);
    if (joinTime) {
      const diffMin = (Date.now() - joinTime) / 1000 / 60;
      const data = getUserData(userId);
      data.totalMinutes += diffMin;
      data.points = Math.floor(data.totalMinutes) + (data.messages||0);
      saveDB();
      voiceSessions.delete(userId);
      checkAndAnnounce5min(userId, guild);
    }
  }
});

setInterval(async ()=>{
  const guild = client.guilds.cache.first();
  if(!guild) return;
  for(const [userId, joinTime] of voiceSessions.entries()){
    const data = getUserData(userId);
    data.totalMinutes+=0.25;
    data.points = Math.floor(data.totalMinutes) + (data.messages||0);
    await checkAndAnnounce5min(userId, guild);
  }
  saveDB();
},15*1000);

client.on(Events.MessageCreate, async (message)=>{
  if(message.author.bot) return;
  if(!message.guild) return;
  if(message.content.trim().length===0) return;
  if(!isInAllowedCategory(message.channel)) return;
  const data = getUserData(message.author.id);
  data.messages+=1;
  data.points = Math.floor(data.totalMinutes) + data.messages;
  saveDB();
});

client.once(Events.ClientReady, async ()=>{
  console.log(`✅ Bot online ${client.user.tag} - Card 5 min in ${ANNOUNCE_CHANNEL_ID}`);
  for(const guild of client.guilds.cache.values()){
    for(const [memberId, voiceState] of guild.voiceStates.cache){
      if(voiceState.channel && memberId!==client.user.id && isInAllowedCategory(voiceState.channel)){
        voiceSessions.set(memberId, Date.now());
      }
    }
  }
  const commands = [
    new SlashCommandBuilder().setName('punti').setDescription('Vedi i tuoi punti'),
    new SlashCommandBuilder().setName('classifica').setDescription('Top 10'),
    new SlashCommandBuilder().setName('card').setDescription('Genera la tua Collector Card'),
  ].map(c=>c.toJSON());
  const rest = new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
  try{ await rest.put(Routes.applicationCommands(client.user.id), {body: commands}); console.log('✅ Slash registrati'); }catch(e){ console.error(e); }
});

client.on(Events.InteractionCreate, async interaction=>{
  if(!interaction.isChatInputCommand()) return;
  if(interaction.commandName==='punti'){
    const data = db.users[interaction.user.id] || {points:0,totalMinutes:0,messages:0};
    const embed = new EmbedBuilder().setColor(0x8a2be2).setTitle(`${ALLOWED_CATEGORY_NAME} - I tuoi punti`).setDescription(`**${data.points} punti** | 🎤 ${data.totalMinutes.toFixed(1)} min | 💬 ${data.messages||0}`).setThumbnail(interaction.user.displayAvatarURL());
    await interaction.reply({embeds:[embed]});
  }
  if(interaction.commandName==='classifica'){
    const sorted = Object.entries(db.users).sort((a,b)=>b[1].points-a[1].points).slice(0,10);
    if(sorted.length===0) return interaction.reply(`Nessuno ha ancora punti!`);
    let desc=''; for(let i=0;i<sorted.length;i++){ const [uid,val]=sorted[i]; desc+=`**${i+1}.** <@${uid}> - ${val.points} punti\n`; }
    const embed = new EmbedBuilder().setColor(0x8a2be2).setTitle(`🏆 Classifica ${ALLOWED_CATEGORY_NAME}`).setDescription(desc);
    await interaction.reply({embeds:[embed]});
  }
  if(interaction.commandName==='card'){
    await interaction.deferReply();
    const data = getUserData(interaction.user.id);
    try{
      const buffer = await generateCard(interaction.user, { voiceTime: data.totalMinutes, messages: data.messages, points: data.points });
      const attachment = new AttachmentBuilder(buffer, { name: `card-${interaction.user.username}.png` });
      const embed = new EmbedBuilder().setColor(0x8a2be2).setTitle(`🔮 ${interaction.user.username} - COLLECTOR CARD`).setDescription(`**${data.points} punti** | 🎤 ${data.totalMinutes.toFixed(1)} min | 💬 ${data.messages} messaggi`).setImage(`attachment://card-${interaction.user.username}.png`);
      await interaction.editReply({ embeds: [embed], files: [attachment] });
    }catch(e){ console.error(e); await interaction.editReply('Errore generazione card'); }
  }
});

client.login(process.env.DISCORD_TOKEN);
