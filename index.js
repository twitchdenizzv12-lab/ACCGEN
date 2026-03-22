const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField
} = require('discord.js');

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

// ===== CONFIG =====
const PREFIX = process.env.PREFIX || '!';
const OWNER_ID = process.env.OWNER_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const GEN_CHANNEL_ID = process.env.GEN_CHANNEL_ID;
const RESTOCK_CHANNEL_ID = process.env.RESTOCK_CHANNEL_ID;

const STOCK_FOLDER = path.join(__dirname, 'stock');
const COOLDOWN_MS = 15 * 1000; // 15 Sekunden Cooldown

const cooldowns = new Map();

const stockFiles = {
  steam: path.join(STOCK_FOLDER, 'steam.txt'),
  fivem: path.join(STOCK_FOLDER, 'fivem.txt')
};

// ===== HILFSFUNKTIONEN =====
function ensureFiles() {
  if (!fs.existsSync(STOCK_FOLDER)) fs.mkdirSync(STOCK_FOLDER);

  for (const type of Object.keys(stockFiles)) {
    if (!fs.existsSync(stockFiles[type])) {
      fs.writeFileSync(stockFiles[type], '', 'utf8');
    }
  }
}

function readStock(type) {
  const file = stockFiles[type];
  if (!file || !fs.existsSync(file)) return [];

  const content = fs.readFileSync(file, 'utf8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function writeStock(type, lines) {
  const file = stockFiles[type];
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

function getStockCount(type) {
  return readStock(type).length;
}

function popAccount(type) {
  const lines = readStock(type);
  if (lines.length === 0) return null;

  const account = lines.shift(); // erste Zeile nehmen
  writeStock(type, lines);
  return account;
}

function addStock(type, entries) {
  const current = readStock(type);
  const cleaned = entries
    .map(e => e.trim())
    .filter(e => e.length > 0);

  const updated = [...current, ...cleaned];
  writeStock(type, updated);

  return cleaned.length;
}

function hasCooldown(userId) {
  const now = Date.now();
  const expires = cooldowns.get(userId);

  if (!expires) return false;
  if (now >= expires) {
    cooldowns.delete(userId);
    return false;
  }

  return Math.ceil((expires - now) / 1000);
}

function setCooldown(userId) {
  cooldowns.set(userId, Date.now() + COOLDOWN_MS);
}

async function sendLog(embed) {
  if (!LOG_CHANNEL_ID) return;

  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (channel) {
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error('Fehler beim Senden des Logs:', err.message);
  }
}

function isAdmin(message) {
  if (message.author.id === OWNER_ID) return true;
  return message.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

// ===== READY =====
client.once('ready', () => {
  ensureFiles();
  console.log(`✅ Bot online als ${client.user.tag}`);
});

// ===== MESSAGE EVENT =====
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();

  // =========================
  // !gen
  // =========================
  if (command === 'gen') {
    // Nur im Gen-Channel erlauben
    if (message.guild && GEN_CHANNEL_ID && message.channel.id !== GEN_CHANNEL_ID) {
      const wrongChannelMsg = await message.reply(
        `❌ Du kannst \`${PREFIX}gen\` nur im <#${GEN_CHANNEL_ID}> Channel benutzen.`
      );

      setTimeout(() => {
        message.delete().catch(() => {});
      }, 2000);

      setTimeout(() => {
        wrongChannelMsg.delete().catch(() => {});
      }, 5000);

      return;
    }

    const type = args[0]?.toLowerCase();

    if (!type || !stockFiles[type]) {
      const usageMsg = await message.reply(`❌ Nutzung: \`${PREFIX}gen steam\` oder \`${PREFIX}gen fivem\``);

      setTimeout(() => {
        message.delete().catch(() => {});
      }, 2000);

      setTimeout(() => {
        usageMsg.delete().catch(() => {});
      }, 5000);

      return;
    }

    const cooldownLeft = hasCooldown(message.author.id);
    if (cooldownLeft) {
      const cdMsg = await message.reply(`⏳ Bitte warte noch **${cooldownLeft}s**, bevor du erneut generierst.`);

      setTimeout(() => {
        message.delete().catch(() => {});
      }, 2000);

      setTimeout(() => {
        cdMsg.delete().catch(() => {});
      }, 5000);

      return;
    }

    const stock = getStockCount(type);
    if (stock <= 0) {
      const noStockMsg = await message.reply(`❌ Kein Stock mehr für **${type}** verfügbar.`);

      setTimeout(() => {
        message.delete().catch(() => {});
      }, 2000);

      setTimeout(() => {
        noStockMsg.delete().catch(() => {});
      }, 5000);

      return;
    }

    const account = popAccount(type);
    if (!account) {
      const errorMsg = await message.reply(`❌ Fehler beim Abrufen des ${type}-Accounts.`);

      setTimeout(() => {
        message.delete().catch(() => {});
      }, 2000);

      setTimeout(() => {
        errorMsg.delete().catch(() => {});
      }, 5000);

      return;
    }

    try {
      // DM an den User
      const dmEmbed = new EmbedBuilder()
        .setTitle(`🎁 Dein ${type.toUpperCase()} Account`)
        .setDescription(
          `Hier ist dein **${type}** Account:\n\n` +
          `\`\`\`\n${account}\n\`\`\`\n` +
          `⚠️ Nur für eigene / legale Testaccounts verwenden.`
        )
        .setColor(0x00ff99)
        .setFooter({ text: 'Der Account wurde nur dir per DM geschickt.' })
        .setTimestamp();

      await message.author.send({ embeds: [dmEmbed] });

      setCooldown(message.author.id);

      // Öffentliche Bestätigung OHNE Account-Daten
      const publicEmbed = new EmbedBuilder()
        .setTitle('✅ Account gesendet')
        .setDescription(`📩 ${message.author}, dein **${type}** Account wurde dir per DM geschickt.`)
        .setColor(0x2ecc71)
        .setTimestamp();

      const replyMsg = await message.reply({ embeds: [publicEmbed] });

      // User Command löschen
      setTimeout(() => {
        message.delete().catch(() => {});
      }, 2000);

      // Bot Antwort löschen
      setTimeout(() => {
        replyMsg.delete().catch(() => {});
      }, 5000);

      // Log
      const logEmbed = new EmbedBuilder()
        .setTitle('📦 Account ausgegeben')
        .addFields(
          { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: false },
          { name: 'Typ', value: type, inline: true },
          { name: 'Restlicher Stock', value: `${getStockCount(type)}`, inline: true },
          { name: 'Guild', value: message.guild ? message.guild.name : 'DM', inline: false }
        )
        .setColor(0x3498db)
        .setTimestamp();

      await sendLog(logEmbed);

    } catch (err) {
      console.error(err);

      // Falls DM fehlschlägt → Account zurück in Stock
      addStock(type, [account]);

      const dmFailMsg = await message.reply(
        '❌ Ich konnte dir keine DM schicken. Bitte aktiviere Direktnachrichten vom Server.'
      );

      setTimeout(() => {
        message.delete().catch(() => {});
      }, 2000);

      setTimeout(() => {
        dmFailMsg.delete().catch(() => {});
      }, 5000);

      return;
    }
  }

  // =========================
  // !stock
  // =========================
  if (command === 'stock') {
    const steamStock = getStockCount('steam');
    const fivemStock = getStockCount('fivem');

    const embed = new EmbedBuilder()
      .setTitle('📊 Aktueller Stock')
      .addFields(
        { name: 'Steam', value: `\`${steamStock}\` Accounts`, inline: true },
        { name: 'FiveM', value: `\`${fivemStock}\` Accounts`, inline: true }
      )
      .setColor(0xf1c40f)
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // =========================
  // !restock
  // =========================
  if (command === 'restock') {
    if (!isAdmin(message)) {
      return message.reply('❌ Dafür brauchst du Admin-Rechte.');
    }

    // Nur im Restock-Channel erlauben
    if (message.guild && RESTOCK_CHANNEL_ID && message.channel.id !== RESTOCK_CHANNEL_ID) {
      return message.reply(`❌ Du kannst \`${PREFIX}restock\` nur im <#${RESTOCK_CHANNEL_ID}> Channel benutzen.`);
    }

    const type = args[0]?.toLowerCase();

    if (!type || !stockFiles[type]) {
      return message.reply(`❌ Nutzung: \`${PREFIX}restock steam account1:pass1 account2:pass2\``);
    }

    const entries = args.slice(1);

    if (entries.length === 0) {
      return message.reply(
        `❌ Bitte gib Accounts an.\nBeispiel:\n\`${PREFIX}restock ${type} mail1:pass1 mail2:pass2 mail3:pass3\``
      );
    }

    const added = addStock(type, entries);

    const embed = new EmbedBuilder()
      .setTitle('✅ Restock erfolgreich')
      .setDescription(`Es wurden **${added}** neue **${type}** Accounts hinzugefügt.`)
      .addFields(
        { name: 'Neuer Stock', value: `${getStockCount(type)}`, inline: true }
      )
      .setColor(0x9b59b6)
      .setTimestamp();

    await message.reply({ embeds: [embed] });

    const logEmbed = new EmbedBuilder()
      .setTitle('📥 Restock')
      .addFields(
        { name: 'Admin', value: `${message.author.tag} (${message.author.id})`, inline: false },
        { name: 'Typ', value: type, inline: true },
        { name: 'Hinzugefügt', value: `${added}`, inline: true },
        { name: 'Neuer Stock', value: `${getStockCount(type)}`, inline: true }
      )
      .setColor(0x8e44ad)
      .setTimestamp();

    await sendLog(logEmbed);
  }

  // =========================
  // !help
  // =========================
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📘 Commands')
      .setDescription(
        `\`${PREFIX}gen steam\` - 1 Steam Account per DM (nur Gen-Channel)\n` +
        `\`${PREFIX}gen fivem\` - 1 FiveM Account per DM (nur Gen-Channel)\n` +
        `\`${PREFIX}stock\` - Zeigt aktuellen Stock\n` +
        `\`${PREFIX}restock steam acc1 acc2 ...\` - Admin only (nur Restock-Channel)\n` +
        `\`${PREFIX}restock fivem acc1 acc2 ...\` - Admin only (nur Restock-Channel)`
      )
      .setColor(0x5865f2)
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
});

// ===== LOGIN =====
client.login(process.env.TOKEN);