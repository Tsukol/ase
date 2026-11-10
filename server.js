const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'users_db.json');
const CHAT_FILE = path.join(__dirname, 'chat_db.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

// === ХРАНИЛИЩЕ В ПАМЯТИ И ЛОКАЛЬНАЯ БД ===
let usersData = {}; 
let nextUserId = 1; 

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

if (fs.existsSync(DB_FILE)) {
    try {
        const rawData = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(rawData);
        usersData = parsed.users || {};
        nextUserId = parsed.nextUserId || (Object.keys(usersData).length + 1);
        
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

// === ЧАТ ТРЕЙДЕРОВ (TROLLBOX) С ПЕРСИСТЕНТНОСТЬЮ ДО 1000 СООБЩЕНИЙ ===
let chatMessages = [
    {
        id: 1,
        username: 'System',
        tag: '#Q8',
        avatarEmoji: '🤖',
        avatarColor: '#8b5cf6',
        text: 'Добро пожаловать в Trollbox терминала ASE! Соблюдайте правила торговли и общения.',
        timestamp: Math.floor(Date.now() / 1000)
    }
];

if (fs.existsSync(CHAT_FILE)) {
    try {
        const rawChat = fs.readFileSync(CHAT_FILE, 'utf8');
        const parsedChat = JSON.parse(rawChat);
        if (Array.isArray(parsedChat) && parsedChat.length > 0) {
            chatMessages = parsedChat;
        }
        console.log('[Chat DB] История чата успешно загружена. Сообщений:', chatMessages.length);
    } catch (e) {
        console.error('[Chat DB] Ошибка чтения истории чата:', e);
    }
}

function saveChatDB() {
    try {
        fs.writeFileSync(CHAT_FILE, JSON.stringify(chatMessages, null, 2), 'utf8');
    } catch (e) {
        console.error('[Chat DB] Ошибка сохранения чата:', e);
    }
}

app.get('/api/chat/messages', (req, res) => {
    res.json({ success: true, messages: chatMessages.slice(-1000) });
});

app.post('/api/chat/send', (req, res) => {
    const { username, password, text } = req.body;
    
    const user = usersData[username];
    if (!user || user.password !== password) {
        return res.status(401).json({ success: false, error: 'Неверные данные авторизации' });
    }

    const cleanText = (text || '').trim();
    if (!cleanText || cleanText.length > 280) {
        return res.json({ success: false, error: 'Сообщение должно быть от 1 до 280 символов' });
    }

    const newMessage = {
        id: Date.now(),
        username: user.username,
        tag: user.tag || '#Q8',
        avatarEmoji: user.avatarEmoji || '👤',
        avatarColor: user.avatarColor || '#00f2fe',
        text: cleanText,
        timestamp: req.body.aatTimestamp || Math.floor(Date.now() / 1000)
    };

    chatMessages.push(newMessage);
    if (chatMessages.length > 1000) chatMessages.shift();

    saveChatDB();

    res.json({ success: true, message: newMessage });
});

// === API 1: АВТОРИЗАЦИЯ / РЕГИСТРАЦИЯ / ПРОФИЛЬ ===
app.post('/api/user/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !username.trim()) {
        return res.status(400).json({ error: 'Имя пользователя не может быть пустым' });
    }

    const cleanName = username.trim();
    let user = usersData[cleanName];

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
            lastRenameAATYear: 2500,
            state: null
        };
        usersData[cleanName] = user;
        saveDB();
        return res.json({ success: true, isNew: true, user: { ...user, tag: user.tag } });
    }

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

app.post('/api/user/save', (req, res) => {
    const { username, newUsername, password, state, notes, profile } = req.body;
    if (!username || !usersData[username]) {
        return res.status(403).json({ error: 'Пользователь не найден' });
    }

    const user = usersData[username];
    if (user.password !== password) {
        return res.status(403).json({ error: 'Ошибка авторизации при сохранении (неверный пароль)' });
    }

    const cleanNewName = newUsername ? newUsername.trim() : '';
    if (cleanNewName && cleanNewName !== username) {
        if (usersData[cleanNewName]) {
            return res.status(400).json({ error: 'Этот никнейм уже занят другим игроком!' });
        }
        user.username = cleanNewName;
        usersData[cleanNewName] = user;
        delete usersData[username];
    }

    if (state) user.state = state;
    if (Array.isArray(notes)) user.notes = notes.slice(0, 50);

    if (profile) {
        if (profile.avatarEmoji) user.avatarEmoji = profile.avatarEmoji;
        if (profile.avatarColor) user.avatarColor = profile.avatarColor;
        if (typeof profile.bio === 'string') user.bio = profile.bio.slice(0, 256);
    }

    saveDB();
    res.json({ success: true, newUsername: cleanNewName || username });
});

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

// === API 4: ПУБЛИЧНЫЙ ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ ===
app.get('/api/user/profile', (req, res) => {
    const username = req.query.username;
    if (!username || !usersData[username]) {
        return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const u = usersData[username];
    let currentCapital = 0;
    if (u.state) {
        currentCapital = u.state.abs || u.state.maxCapitalLast4Months || 0;
    }

    res.json({
        success: true,
        user: {
            username: u.username,
            tag: u.tag || generateUserTag(u.id || 1),
            avatarEmoji: u.avatarEmoji || '👤',
            avatarColor: u.avatarColor || '#00f2fe',
            bio: u.bio || '',
            capital: currentCapital
        }
    });
});

// === API ЗАМЕТОК ===
app.post('/api/notes/get', (req, res) => {
    const { username, password } = req.body;
    const user = usersData[username];
    if (!user || user.password !== password) {
        return res.status(403).json({ success: false, error: 'Ошибка авторизации' });
    }
    if (!user.notes) user.notes = [];
    res.json({ success: true, notes: user.notes });
});

app.post('/api/notes/save', (req, res) => {
    const { username, password, id, title, text } = req.body;
    const user = usersData[username];
    if (!user || user.password !== password) {
        return res.status(403).json({ success: false, error: 'Ошибка авторизации' });
    }

    if (!user.notes) user.notes = [];

    const noteTitle = (title || '').trim();
    const noteText = (text || '').trim();

    if (!noteText) {
        return res.status(400).json({ success: false, error: 'Текст заметки не может быть пустым' });
    }
    if (noteTitle.length > 40) {
        return res.status(400).json({ success: false, error: 'Заголовок не должен превышать 40 символов' });
    }
    if (noteText.length > 1536) {
        return res.status(400).json({ success: false, error: 'Текст заметки не должен превышать 1536 символов' });
    }

    const existingIndex = user.notes.findIndex(n => n.id === id);

    if (existingIndex === -1 && user.notes.length >= 50) {
        return res.status(400).json({ success: false, error: 'Достигнут лимит: максимум 50 заметок!' });
    }

    if (existingIndex !== -1) {
        user.notes[existingIndex].title = noteTitle || 'Без названия';
        user.notes[existingIndex].text = noteText;
        user.notes[existingIndex].updatedAt = new Date().toISOString();
    } else {
        user.notes.push({
            id: Date.now(),
            title: noteTitle || 'Без названия',
            text: noteText,
            updatedAt: new Date().toISOString()
        });
    }

    saveDB();
    res.json({ success: true, notes: user.notes });
});

app.post('/api/notes/delete', (req, res) => {
    const { username, password, id } = req.body;
    const user = usersData[username];
    if (!user || user.password !== password) {
        return res.status(403).json({ success: false, error: 'Ошибка авторизации' });
    }

    if (!user.notes) user.notes = [];
    user.notes = user.notes.filter(n => n.id !== Number(id));

    saveDB();
    res.json({ success: true, notes: user.notes });
});

app.listen(PORT, () => {
    console.log(`[ASE Server v1.3.0] Сервер запущен на порту ${PORT}`);
});
