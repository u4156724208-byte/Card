
require('dotenv').config();
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');
http.createServer((req, res) => { res.writeHead(200); res.end('Blackout 404 Bot is online'); }).listen(process.env.PORT || 10000);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages]
});

let db = { users: {} };
const DB_FILE = './database.json';
function loadDB(){ if(fs.existsSync(DB_FILE)){ try{ db=JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }catch(e){} } }
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
loadDB();
const voiceSessions = new Map();

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
      if (!db.users[userId]) db.users[userId] = { points: 0, totalMinutes: 0 };
      db.users[userId].totalMinutes += diffMin;
      db.users[userId].points += Math.floor(db.users[userId].totalMinutes) - (Math.floor(db.users[userId].totalMinutes - diffMin));
      // più semplice: aggiungi punti = floor minuti totali aggiunti
      // ricalcoliamo: punti = totalMinutes floor, ma meglio aggiungere direttamente
      // per non complicare, aggiungiamo floor(diffMin) + gestiamo i resti tramite totalMinutes
      if (diffMin < 1) {
        // salva comunque i minuti anche se <1
        db.users[userId].points += 0;
      } else {
        db.users[userId].points += Math.floor(diffMin);
      }
      // Fix punti = floor(totalMinutes) per coerenza
      db.users[userId].points = Math.floor(db.users[userId].totalMinutes);
      saveDB();
      voiceSessions.delete(userId);
      console.log(`[SAVE] ${userId} ora ha ${db.users[userId].points} punti, ${db.users[userId].totalMinutes.toFixed(1)} min`);
    }
  }
});

// Ogni 15 secondi controlla e aggiunge punti
setInterval(() => {
  for (const [userId, joinTime] of voiceSessions.entries()) {
    const diffMin = (Date.now() - joinTime) / 1000 / 60;
    if (diffMin >= 0.2) { // almeno 12 sec, per test rapido
      if (!db.users[userId]) db.users[userId] = { points: 0, totalMinutes: 0 };
      // Aggiungi solo il tempo passato dall'ultimo check (15 sec = 0.25 min)
      const prevTotal = db.users[userId].totalMinutes;
      db.users[userId].totalMinutes += 0.25;
      const newPoints = Math.floor(db.users[userId].totalMinutes);
      if (newPoints > db.users[userId].points) {
        db.users[userId].points = newPoints;
        console.log(`[TICK] ${userId} +0.25 min -> ${db.users[userId].totalMinutes.toFixed(2)} min, ${db.users[userId].points} punti`);
      }
      voiceSessions.set(userId, Date.now()); // reset per prossimo tick da 0.25
      // In realtà vogliamo resettare solo dopo aver contato 1 min, ma per semplicità contiamo a scaglioni
      // FIX più preciso: non resettare, ma lascia accumulare? No, per ora reset a now per contare ogni 15 sec come 0.25
      // Per coerenza punti = floor(totalMinutes), reset giusto
      // Ricostruiamo correttamente: invece di resettare, sottraiamo solo se abbiamo superato 1 min? Facciamo semplice:
      // Teniamo joinTime fisso e calcoliamo sempre diff totale - ma così darebbe punti multipli.
      // Soluzione semplice finale: aggiungi 0.25 min ogni tick e ricalcola punti
    }
  }
  saveDB();
}, 15*1000);

// All'avvio, conta chi è già dentro
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
    new SlashCommandBuilder().setName('classifica').setDescription('Top 10 chi sta di piu in vocale'),
  ].map(c=>c.toJSON());
  const rest = new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
  try { await rest.put(Routes.applicationCommands(client.user.id), {body: commands}); console.log('✅ Slash registrati'); } catch(e){ console.error(e); }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'punti') {
    const data = db.users[interaction.user.id] || { points:0, totalMinutes:0 };
    const embed = new EmbedBuilder().setColor(0x8a2be2).setTitle('🔮 BLACKOUT 404 - I tuoi punti').setDescription(`Hai **${data.points} punti**\nTempo in vocale: **${Math.floor(data.totalMinutes)} min (${data.totalMinutes.toFixed(1)} min reali)**`).setThumbnail(interaction.user.displayAvatarURL());
    await interaction.reply({embeds:[embed]});
  }
  if (interaction.commandName === 'classifica') {
    const sorted = Object.entries(db.users).sort((a,b)=>b[1].points-a[1].points).slice(0,10);
    if (sorted.length===0) return interaction.reply('Nessuno ha ancora punti! Fatti un giro in vocale per 1 min!');
    let desc=''; for(let i=0;i<sorted.length;i++){ const [uid,val]=sorted[i]; desc+=`**${i+1}.** <@${uid}> - ${val.points} punti (${Math.floor(val.totalMinutes)} min)\n`; }
    const embed = new EmbedBuilder().setColor(0x8a2be2).setTitle('🏆 Classifica Party - Blackout 404').setDescription(desc);
    await interaction.reply({embeds:[embed]});
  }
});

client.login(process.env.DISCORD_TOKEN);
