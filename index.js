
require('dotenv').config();
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');
http.createServer((req, res) => { res.writeHead(200); res.end('Blackout 404 Bot is online'); }).listen(process.env.PORT || 10000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildVoiceStates, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let db = { users: {} };
const DB_FILE = './database.json';
function loadDB(){ if(fs.existsSync(DB_FILE)){ try{ db=JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }catch(e){} } }
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
loadDB();

function getUserData(userId){
  if(!db.users[userId]) db.users[userId] = { points: 0, totalMinutes: 0, messages: 0 };
  if(db.users[userId].messages === undefined) db.users[userId].messages = 0;
  if(db.users[userId].totalMinutes === undefined) db.users[userId].totalMinutes = 0;
  return db.users[userId];
}

const voiceSessions = new Map();

// --- VOICE LOGIC ---
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const userId = newState.id || oldState.id;
  if (userId === client.user.id) return;
  const hadChannel = !!oldState.channel;
  const hasChannel = !!newState.channel;
  
  if (!hadChannel && hasChannel) {
    voiceSessions.set(userId, Date.now());
    console.log(`[JOIN] ${userId} in ${newState.channel.name}`);
  }
  if (hadChannel && !hasChannel) {
    const joinTime = voiceSessions.get(userId);
    if (joinTime) {
      const diffMin = (Date.now() - joinTime) / 1000 / 60;
      console.log(`[LEAVE] ${userId} dopo ${diffMin.toFixed(2)} min`);
      const data = getUserData(userId);
      const oldFloor = Math.floor(data.totalMinutes);
      data.totalMinutes += diffMin;
      const newFloor = Math.floor(data.totalMinutes);
      const gained = newFloor - oldFloor;
      if (gained > 0) {
        data.points += gained;
        console.log(`[VOICE SAVE] ${userId} +${gained} punti vocale -> ${data.points} totali`);
      }
      saveDB();
      voiceSessions.delete(userId);
    }
  }
});

// Ogni 15 secondi aggiunge tempo vocale
setInterval(() => {
  let changed = false;
  for (const [userId, joinTime] of voiceSessions.entries()) {
    const data = getUserData(userId);
    const oldFloor = Math.floor(data.totalMinutes);
    data.totalMinutes += 0.25; // 15 sec = 0.25 min
    const newFloor = Math.floor(data.totalMinutes);
    if (newFloor > oldFloor) {
      data.points += (newFloor - oldFloor);
      console.log(`[TICK VOICE] ${userId} +${newFloor-oldFloor} punto -> ${data.totalMinutes.toFixed(2)} min, ${data.points} punti`);
      changed = true;
    }
    // reset joinTime per evitare doppio conteggio nel leave (teniamo traccia con totalMinutes)
    voiceSessions.set(userId, Date.now());
  }
  if (changed) saveDB();
  else if (voiceSessions.size > 0) saveDB();
}, 15*1000);

// --- CHAT LOGIC: 1 punto per messaggio ---
client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) return;
  if (!message.guild) return; // solo server, no DM
  const userId = message.author.id;
  if (message.content.trim().length === 0) return; // ignora solo embed/sticker vuoti
  
  const data = getUserData(userId);
  data.points += 1;
  data.messages += 1;
  saveDB();
  console.log(`[CHAT] ${message.author.tag} (${userId}) +1 punto chat -> ${data.points} totali | "${message.content.slice(0,30)}"`);
});

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot online come ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    for (const [memberId, voiceState] of guild.voiceStates.cache) {
      if (voiceState.channel && memberId !== client.user.id) {
        if (!voiceSessions.has(memberId)) {
          voiceSessions.set(memberId, Date.now());
          console.log(`[INIT JOIN] ${memberId} già in ${voiceState.channel.name}`);
        }
      }
    }
  }
  const commands = [
    new SlashCommandBuilder().setName('punti').setDescription('Vedi i tuoi punti party'),
    new SlashCommandBuilder().setName('classifica').setDescription('Top 10 chi sta di piu in vocale e chatta'),
  ].map(c=>c.toJSON());
  const rest = new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
  try { await rest.put(Routes.applicationCommands(client.user.id), {body: commands}); console.log('✅ Slash registrati'); } catch(e){ console.error(e); }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'punti') {
    const data = db.users[interaction.user.id] || { points:0, totalMinutes:0, messages:0 };
    const embed = new EmbedBuilder().setColor(0x8a2be2).setTitle('🔮 BLACKOUT 404 - I tuoi punti').setDescription(`Hai **${data.points} punti** totali\n💬 Messaggi: **${data.messages || 0}** (+1 punto per messaggio)\n🎤 Tempo in vocale: **${Math.floor(data.totalMinutes || 0)} min** (${(data.totalMinutes||0).toFixed(1)} min reali)`).setThumbnail(interaction.user.displayAvatarURL());
    await interaction.reply({embeds:[embed]});
  }
  if (interaction.commandName === 'classifica') {
    const sorted = Object.entries(db.users).sort((a,b)=>b[1].points-a[1].points).slice(0,10);
    if (sorted.length===0) return interaction.reply('Nessuno ha ancora punti! Scrivi in chat o entra in vocale!');
    let desc=''; for(let i=0;i<sorted.length;i++){ const [uid,val]=sorted[i]; desc+=`**${i+1}.** <@${uid}> - ${val.points} punti (💬${val.messages||0} | 🎤${Math.floor(val.totalMinutes||0)}min)\n`; }
    const embed = new EmbedBuilder().setColor(0x8a2be2).setTitle('🏆 Classifica Party - Blackout 404').setDescription(desc);
    await interaction.reply({embeds:[embed]});
  }
});

client.login(process.env.DISCORD_TOKEN);
