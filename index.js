
require('dotenv').config();
const { Client, GatewayIntentBits, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const http = require('http');

// Piccolo server HTTP per Render (cosi non va in sleep)
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
      if (diffMin >= 1) {
        if (!db.users[userId]) db.users[userId] = { points: 0, totalMinutes: 0 };
        db.users[userId].totalMinutes += diffMin;
        db.users[userId].points += Math.floor(diffMin);
        saveDB();
      }
      voiceSessions.delete(userId);
    }
  }
});

setInterval(() => {
  for (const [userId, joinTime] of voiceSessions.entries()) {
    const diffMin = (Date.now() - joinTime) / 1000 / 60;
    if (diffMin >= 1) {
      if (!db.users[userId]) db.users[userId] = { points: 0, totalMinutes: 0 };
      db.users[userId].totalMinutes += 1;
      db.users[userId].points += 1;
      voiceSessions.set(userId, Date.now());
    }
  }
  saveDB();
}, 60*1000);

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot online come ${client.user.tag}`);
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
    const embed = new EmbedBuilder().setColor(0x8a2be2).setTitle('🔮 BLACKOUT 404 - I tuoi punti').setDescription(`Hai **${data.points} punti**\nTempo in vocale: **${Math.floor(data.totalMinutes)} min**`).setThumbnail(interaction.user.displayAvatarURL());
    await interaction.reply({embeds:[embed]});
  }
  if (interaction.commandName === 'classifica') {
    const sorted = Object.entries(db.users).sort((a,b)=>b[1].points-a[1].points).slice(0,10);
    if (sorted.length===0) return interaction.reply('Nessuno ha ancora punti!');
    let desc=''; for(let i=0;i<sorted.length;i++){ const [uid,val]=sorted[i]; desc+=`**${i+1}.** <@${uid}> - ${val.points} punti (${Math.floor(val.totalMinutes)} min)\n`; }
    const embed = new EmbedBuilder().setColor(0x8a2be2).setTitle('🏆 Classifica Party - Blackout 404').setDescription(desc);
    await interaction.reply({embeds:[embed]});
  }
});

client.login(process.env.DISCORD_TOKEN);
