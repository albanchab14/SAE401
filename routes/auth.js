const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../src/config/database');

router.get('/login', (req, res) => res.render('login.njk', { page: 'login' }));
router.get('/register', (req, res) => res.render('register.njk', { page: 'register' }));
router.get('/connexion', (req, res) => res.redirect('/login'));
router.get('/inscription', (req, res) => res.redirect('/register'));

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.render('login.njk', { page: 'login', error: "Aucun compte n'est associé à cette adresse email." });
        
        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (isMatch) {
            const [settings] = await db.query('SELECT is_maintenance FROM site_settings WHERE id = 1');
            const isMaintenance = settings.length > 0 ? settings[0].is_maintenance : false;
            
            if (isMaintenance && user.role !== 'admin') return res.render('login.njk', { page: 'login', error: "🛠 Le site est en maintenance." });
            if (user.is_banned == 1) return res.render('login.njk', { page: 'login', error: "🚨 Votre compte a été banni." });
            
            req.session.user = { id: user.id, pseudo: user.pseudo, role: user.role, avatar: user.avatar };
            res.redirect(user.role === 'admin' ? '/admin' : '/');
        } else {
            return res.render('login.njk', { page: 'login', error: "Le mot de passe est incorrect." });
        }
    } catch (error) { res.render('login.njk', { page: 'login', error: "Erreur serveur." }); }
});

router.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const [existingUsers] = await db.query('SELECT * FROM users WHERE email = ? OR pseudo = ?', [email, username]);
        if (existingUsers.length > 0) return res.render('register.njk', { page: 'register', error: "Cet email ou ce nom d'utilisateur est déjà utilisé." });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.query('INSERT INTO users (pseudo, email, password, role) VALUES (?, ?, ?, ?)', [username, email, hashedPassword, 'utilisateur']);
        
        req.session.user = { id: result.insertId, pseudo: username, role: 'utilisateur', avatar: null };
        res.redirect('/');
    } catch (error) { res.render('register.njk', { page: 'register', error: "Une erreur est survenue lors de l'inscription." }); }
});

router.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/'); 
});

module.exports = router;