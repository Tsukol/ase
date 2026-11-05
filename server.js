const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'users_db.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

// === ХРАНИЛИЩЕ В ПАМЯТИ И ЛОКАЛЬНАЯ БД ===
let usersData = {}; // Ключ — имя пользователя (username)
let globalChatMessages = [];
let nextUserId = 1; 
const userChatCooldowns = {}; 

// Фирменный алфавит тегов ASE (14 символов)
const TAG_CHARS = "0289PYLQGRJCUV"; 
const BASE = TAG_CHARS.length;

function generateUserTag(idNumber) {
    let num = (idNumber || 1) * 256; 
    let res = "";
    while (num > 0) {
        res = TAG_CHARS[num % BASE] + res;
        num = Math.floor(num / BASE);
    }
    return "#" + res;
}

// Загрузка базы пользователей из файла при старте
if (fs.existsSync(DB_FILE)) {
    try {
        const rawData = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(rawData);
        usersData = parsed.users || {};
        nextUserId = parsed.nextUserId || (Object.keys(usersData).length + 1);
        
        // Проверяем старых юзеров на наличие ID и тегов
        Object.values(usersData).forEach(u => {
            if (!u.id) u.id = nextUserId++;
            if (!u.tag) u.tag = generateUserTag(u.id);
        });

        console.log('[DB] База пользователей успешно загружена. Всего игроков:', Object.keys(usersData).length);
    } catch (e) {
        console.error('[DB] Ошибка чтения базы пользователей:', e);
    }
}

function saveDB() {
    try {
        const dataToSave = {
            nextUserId: nextUserId,
            users: usersData
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (e) {
        console.error('[DB] Ошибка сохранения базы:', e);
    }
}

// === API 1: АВТОРИЗАЦИЯ / РЕГИСТРАЦИЯ / ПРОФИЛЬ ===
app.post('/api/user/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !username.trim()) {
        return res.status(400).json({ error: 'Имя пользователя не может быть пустым' });
    }

    const cleanName = username.trim();
    let user = usersData[cleanName];

    // 1. Создание абсолютно нового аккаунта
    if (!user) {
        if (!password || !password.trim()) {
            return res.status(400).json({ error: 'Для создания нового аккаунта задайте пароль.' });
        }
        const newId = nextUserId++;
        user = {
            id: newId,
            username: cleanName,
            password: password.trim(),
            tag: generateUserTag(newId),
            avatarEmoji: '👤',
            avatarColor: '#00f2fe',
            bio: '',
            notes: [],
            lastRenameAATYear: 2466,
            state: null // Чистый прогресс для нового игрока
        };
        usersData[cleanName] = user;
        saveDB();
        return res.json({ success: true, isNew: true, user: { ...user, tag: user.tag } });
    }

    // 2. Привязка пароля к старому аккаунту без пароля
    if (!user.password) {
        if (!password || !password.trim()) {
            return res.status(400).json({ error: 'Этот аккаунт еще не защищен паролем. Введите новый пароль для привязки.' });
        }
        user.password = password.trim();
        if (!user.id) user.id = nextUserId++;
        if (!user.tag) user.tag = generateUserTag(user.id);
        if (!user.notes) user.notes = [];
        saveDB();
        return res.json({ success: true, user: { ...user, tag: user.tag } });
    }

    // 3. Проверка пароля существующего аккаунта
    if (user.password !== (password || '').trim()) {
        return res.status(401).json({ error: 'Неверный пароль для этого пользователя!' });
    }

    if (!user.id) user.id = nextUserId++;
    if (!user.tag) user.tag = generateUserTag(user.id);
    if (!user.notes) user.notes = [];
    if (!user.avatarEmoji) user.avatarEmoji = '👤';
    if (!user.avatarColor) user.avatarColor = '#00f2fe';

    res.json({ success: true, user: { ...user, tag: user.tag } });
});

// Сохранение игрового прогресса, заметок и профиля с поддержкой смены никнейма
app.post('/api/user/save', (req, res) => {
    const { username, newUsername, password, state, notes, profile } = req.body;
    if (!username || !usersData[username]) {
        return res.status(403).json({ error: 'Пользователь не найден' });
    }

    const user = usersData[username];
    if (user.password !== password) {
        return res.status(403).json({ error: 'Ошибка авторизации при сохранении (неверный пароль)' });
    }

    // Если игрок решил сменить никнейм
    const cleanNewName = newUsername ? newUsername.trim() : '';
    if (cleanNewName && cleanNewName !== username) {
        if (usersData[cleanNewName]) {
            return res.status(400).json({ error: 'Этот никнейм уже занят другим игроком!' });
        }
        // Переносим данные на новый ключ и обновляем поле username внутри объекта
        user.username = cleanNewName;
        usersData[cleanNewName] = user;
        delete usersData[username];
    }

    // Сохраняем прогресс и настройки
    if (state) user.state = state;
    if (Array.isArray(notes)) user.notes = notes.slice(0, 10);

    if (profile) {
        if (profile.avatarEmoji) user.avatarEmoji = profile.avatarEmoji;
        if (profile.avatarColor) user.avatarColor = profile.avatarColor;
        if (typeof profile.bio === 'string') user.bio = profile.bio.slice(0, 256);
    }

    saveDB();
    res.json({ success: true, newUsername: cleanNewName || username });
});

    

// Смена пароля
app.post('/api/user/change-password', (req, res) => {
    const { username, oldPassword, newPassword } = req.body;
    const user = usersData[username];

    if (!user || user.password !== oldPassword) {
        return res.status(403).json({ error: 'Старый пароль введен неверно' });
    }
    if (!newPassword || newPassword.trim().length < 3) {
        return res.status(400).json({ error: 'Новый пароль слишком короткий' });
    }

    user.password = newPassword.trim();
    saveDB();
    res.json({ success: true });
});

// === API 2: ЧАТ ТРЕЙДЕРОВ (TROLLBOX) ===
app.get('/api/chat', (req, res) => {
    res.json({ messages: globalChatMessages.slice(-50) });
});

app.post('/api/chat', (req, res) => {
    const { username, text, aatTimeStr } = req.body;
    const user = usersData[username];

    if (!user) {
        return res.status(403).json({ error: 'Отправлять сообщения могут только авторизованные игроки' });
    }

    const now = Date.now();
    const lastSend = userChatCooldowns[username] || 0;
    if (now - lastSend < 2500) {
        const waitSec = ((2500 - (now - lastSend)) / 1000).toFixed(1);
        return res.status(429).json({ error: `Слишком часто! Подождите ${waitSec} сек.` });
    }

    if (!text || !text.trim()) {
        return res.status(400).json({ error: 'Пустое сообщение' });
    }

    const cleanText = text.trim().slice(0, 512);
    userChatCooldowns[username] = now;

    if (!user.tag) user.tag = generateUserTag(user.id || 1);

    const msgObj = {
        id: Date.now() + Math.random().toString(36).substr(2, 4),
        user: user.username,
        tag: user.tag,
        emoji: user.avatarEmoji || '👤',
        color: user.avatarColor || '#00f2fe',
        text: cleanText,
        aatTime: aatTimeStr || 'AAT',
        timestamp: now
    };

    globalChatMessages.push(msgObj);
    if (globalChatMessages.length > 200) globalChatMessages.shift();

    res.json({ success: true, messages: globalChatMessages.slice(-50) });
});

// === API 3: ТАБЛИЦА ЛИДЕРОВ ===
app.get('/api/leaderboard', (req, res) => {
    const list = Object.values(usersData)
        .filter(u => u.state)
        .map(u => ({
            username: u.username,
            tag: u.tag || generateUserTag(u.id || 1),
            emoji: u.avatarEmoji || '👤',
            color: u.avatarColor || '#00f2fe',
            peakCap: u.state.maxCapitalLast4Months || u.state.abs,
            lastActionTime: u.state.lastActionTime || (u.state.history && u.state.history.length > 0 ? u.state.history[0].timestamp : 0)
        }));
    res.json(list);
});

app.listen(PORT, () => {
    console.log(`[ASE Server v1.3.0] Сервер запущен на порту ${PORT}`);
});
