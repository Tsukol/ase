const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors());

// Подключаем базу данных SQLite (файл создастся автоматически)
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), (err) => {
    if (err) console.error('Ошибка подключения к БД', err.message);
    else console.log('База данных SQLite подключена.');
});

// Создаем таблицу пользователей, если ее нет
db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    data TEXT
)`);

// 1. Получить данные конкретного пользователя
app.get('/api/user/:username', (req, res) => {
    const { username } = req.params;
    db.get(`SELECT data FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.json({ found: false });
        res.json({ found: true, data: JSON.parse(row.data) });
    });
});

// 2. Сохранить / обновить данные пользователя
app.post('/api/user/:username', (req, res) => {
    const { username } = req.params;
    const userData = JSON.stringify(req.body);

    db.run(`INSERT INTO users (username, data) VALUES (?, ?) 
            ON CONFLICT(username) DO UPDATE SET data = ?`, 
            [username, userData, userData], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 3. Получить список всех пользователей (для таблицы лидеров)
app.get('/api/leaderboard', (req, res) => {
    db.all(`SELECT username, data FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const users = rows.map(row => ({
            username: row.username,
            data: JSON.parse(row.data)
        }));
        res.json(users);
    });
});

const PORT = process.env.PORT || 3000;

// Добавьте эту строку перед app.listen:
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});