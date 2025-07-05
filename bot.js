// bot.js
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');
const XLSX = require('xlsx');

// === CONFIG ===
const TOKEN = '7476023842:AAFyYp9fkQ5zXyJ7DXvXfj0TSg974q5q6O0';
const bot = new TelegramBot(TOKEN, { polling: true });

// === Express Keep Alive ===
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(8080, () => console.log('✅ Express server running on port 8080'));

// === Load Hadith Data ===
const hadithWorkbook = XLSX.readFile('hadith.xlsx');
const hadithSheet = hadithWorkbook.Sheets[hadithWorkbook.SheetNames[0]];
const hadithData = XLSX.utils.sheet_to_json(hadithSheet);

// === Quran API Helpers ===
const getSurahs = async () => {
  const response = await axios.get('https://api.alquran.cloud/v1/surah');
  return response.data.data.map(s => ({
    id: s.number,
    name: s.name,
    ayah_count: s.numberOfAyahs
  }));
};

const getSurahKeyboard = async (page = 1, perPage = 50) => {
  const surahs = await getSurahs();
  const start = (page - 1) * perPage;
  const end = Math.min(start + perPage, surahs.length);

  const keyboard = surahs.slice(start, end).map(s => [
    { text: `${s.id}: ${s.name}`, callback_data: `surah-${s.id}` }
  ]);

  const navRow = [];
  if (page > 1) navRow.push({ text: '⬅️ Previous', callback_data: `page-${page - 1}` });
  if (end < surahs.length) navRow.push({ text: 'Next ➡️', callback_data: `page-${page + 1}` });
  if (navRow.length) keyboard.push(navRow);

  return { reply_markup: { inline_keyboard: keyboard } };
};

const getMainMenu = () => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📖 Quran', callback_data: 'menu-quran' },
        { text: '🕌 Hadith', callback_data: 'menu-hadith' }
      ]
    ]
  }
});

// === Commands ===
bot.onText(/\/start|\/home/, msg => {
  bot.sendMessage(msg.chat.id, 'Welcome! Choose an option:', getMainMenu());
});

bot.onText(/\/quran/, async msg => {
  const keyboard = await getSurahKeyboard();
  bot.sendMessage(msg.chat.id, 'Select a Surah:', keyboard);
});

bot.onText(/\/hadith/, msg => {
  const keyboard = {
    reply_markup: {
      inline_keyboard: hadithData.map(h => [
        { text: `Hadith ${h.id}`, callback_data: `hadith-${h.id}` }
      ])
    }
  };
  bot.sendMessage(msg.chat.id, 'Select a Hadith:', keyboard);
});

// === Callback Handler ===
bot.on('callback_query', async callback => {
  const { data, message } = callback;

  if (data === 'menu-quran') {
    const keyboard = await getSurahKeyboard();
    bot.editMessageText('Select a Surah:', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      ...keyboard
    });

  } else if (data === 'menu-hadith') {
    const keyboard = {
      reply_markup: {
        inline_keyboard: hadithData.map(h => [
          { text: `Hadith ${h.id}`, callback_data: `hadith-${h.id}` }
        ])
      }
    };
    bot.editMessageText('Select a Hadith:', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      ...keyboard
    });

  } else if (data.startsWith('page-')) {
    const page = parseInt(data.split('-')[1]);
    const keyboard = await getSurahKeyboard(page);
    bot.editMessageText('Select a Surah:', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      ...keyboard
    });

  } else if (data.startsWith('surah-')) {
    const surahId = parseInt(data.split('-')[1]);
    const surahs = await getSurahs();
    const surah = surahs.find(s => s.id === surahId);

    const ayahButtons = [];
    for (let i = 1; i <= surah.ayah_count; i++) {
      ayahButtons.push([{ text: `Ayah ${i}`, callback_data: `ayah-${surahId}-${i}` }]);
    }

    bot.sendMessage(message.chat.id, `Surah ${surah.name} selected. Choose an Ayah:`, {
      reply_markup: { inline_keyboard: ayahButtons.slice(0, 50) }
    });

  } else if (data.startsWith('hadith-')) {
    const id = parseInt(data.split('-')[1]);
    const h = hadithData.find(h => h.id === id);
    const msg = `📜 *Hadith ${h.id}*\n\n*Arabic:*\n${h.hadith_ar}\n\n*Kurdish:*\n${h.hadith_ku}\n\n*Sahih:* ${h.hadith_sahih}\n*Explanation:* ${h.hadith_geranawa}`;
    bot.sendMessage(message.chat.id, msg, { parse_mode: 'Markdown' });

  } else if (data.startsWith('ayah-')) {
    const [, surah, ayah] = data.split('-');
    try {
      const arabicRes = await axios.get(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/ar`);
      const kurdishRes = await axios.get(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/ku.asan`);

      const arabic = arabicRes.data.data.text;
      const kurdish = kurdishRes.data.data.text;

      const msg = `📖 *Surah ${surah}, Ayah ${ayah}*\n\n*Arabic:*\n${arabic}\n\n*Kurdish:*\n${kurdish}`;
      bot.sendMessage(message.chat.id, msg, { parse_mode: 'Markdown' });

      const surahStr = surah.toString().padStart(3, '0');
      const ayahStr = ayah.toString().padStart(3, '0');
      const audio = `https://everyayah.com/data/Nasser_Alqatami_128kbps/${surahStr}${ayahStr}.mp3`;
      bot.sendAudio(message.chat.id, audio, { caption: `🎧 Surah ${surah}, Ayah ${ayah}` });

    } catch (err) {
      console.error(err);
      bot.sendMessage(message.chat.id, '❌ Failed to fetch Ayah.');
    }
  }

  bot.answerCallbackQuery(callback.id);
});
