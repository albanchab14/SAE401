const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const session = require('express-session');
require('dotenv').config();

const app = express();
const port = 3000;

// --- CONFIGURATION MOTEUR DE VUE ---
nunjucks.configure('views', { autoescape: true, express: app });

// --- MIDDLEWARES GLOBAUX ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); 

app.use(session({
    secret: 'bpm_super_secret_key',
    resave: false,
    saveUninitialized: false
}));

// Variable globale de l'utilisateur pour Nunjucks
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// --- IMPORTATION DES ROUTES DÉCOUPÉES ---
// On importe les fichiers qui se trouvent dans le dossier /routes
const pagesRoutes = require('./routes/pages');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

// On demande à Express de les utiliser
app.use('/', pagesRoutes);       // Tout ce qui est /, /search, /details...
app.use('/', authRoutes);        // Tout ce qui est /login, /register, /logout
app.use('/admin', adminRoutes);  // Tout ce qui commence par /admin
app.use('/api', apiRoutes);      // Tout ce qui commence par /api

// --- LANCEMENT DU SERVEUR ---
app.listen(port, () => { 
    console.log(`✅ Serveur BPM lancé sur http://localhost:${port}`); 
});