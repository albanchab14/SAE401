const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const session = require('express-session');
const db = require('./src/config/database'); // <-- J'avais oublié de remettre la base de données ici !
require('dotenv').config();

const app = express();
const port = 3000;

// --- CONFIGURATION MOTEUR DE VUE ---
nunjucks.configure('views', { autoescape: true, express: app });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); 

app.use(session({
    secret: 'bpm_super_secret_key',
    resave: false,
    saveUninitialized: false
}));

// --- SÉCURITÉ : LE VIGILE DE LA MAINTENANCE ---
app.use(async (req, res, next) => {
    // 1. On laisse toujours passer le CSS, les images et les API internes
    if (req.path.startsWith('/css') || req.path.startsWith('/images') || req.path.startsWith('/api')) {
        return next();
    }
    
    try {
        // 2. On vérifie dans la BDD si le site est en maintenance
        const [settings] = await db.query('SELECT is_maintenance, maintenance_message FROM site_settings WHERE id = 1');
        const isMaintenance = settings.length > 0 ? settings[0].is_maintenance : false;
        const maintenanceMsg = settings.length > 0 ? settings[0].maintenance_message : "Le site fait peau neuve. De retour dans quelques minutes !";

        if (isMaintenance) {
            // 3. On regarde si la personne est connectée ET si elle est admin
            const isAdmin = req.session.user && req.session.user.role === 'admin';
            
            // 4. Si ce N'EST PAS un admin (visiteur normal ou user normal)
            if (!isAdmin) {
                // On l'autorise UNIQUEMENT à voir les pages de connexion/inscription
                if (['/login', '/connexion', '/register', '/inscription'].includes(req.path)) {
                    return next();
                }
                
                // Pour TOUTES les autres pages, on affiche la barrière de maintenance
                return res.status(503).send(`
                    <body style='background:#09090b; color:white; font-family:"Inter", sans-serif; height:100vh; margin:0; display:flex; justify-content:center; align-items:center;'>
                        <div style='text-align:center; background:#18181b; padding:40px; border-radius:24px; border:1px solid #27272a; max-width:400px; box-shadow: 0 20px 50px rgba(0,0,0,0.8);'>
                            <h1 style='font-size: 2rem; margin-top:0; margin-bottom: 20px; color:#d946ef;'>🛠 En maintenance</h1>
                            <p style='color: #a1a1aa; line-height:1.6; margin-bottom:30px; font-size: 15px;'>${maintenanceMsg}</p>
                            <a href="/login" style='background:white; color:black; padding:10px 20px; border-radius:10px; text-decoration:none; font-weight:bold; font-size: 13px;'>Connexion Administrateur</a>
                        </div>
                    </body>
                `);
            }
        }
        // Si la maintenance est désactivée, OU si c'est un admin, on laisse passer !
        next();
    } catch (e) { 
        console.error("Erreur vérification maintenance :", e);
        next(); 
    }
});

// Variable globale de l'utilisateur ET compteur de notifications pour Nunjucks
app.use(async (req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.unreadNotifs = 0; // Par défaut, 0 notification

    // Si le mec est connecté, on compte ses notifications non lues
    if (req.session.user) {
        try {
            const [[{ count }]] = await db.query(
                'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', 
                [req.session.user.id]
            );
            res.locals.unreadNotifs = count; // Envoie le chiffre exact au point violet !
        } catch (e) {
            console.error("Erreur compteur notifs:", e);
        }
    }
    next();
});

// --- IMPORTATION DES ROUTES DÉCOUPÉES ---
const pagesRoutes = require('./routes/pages');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

app.use('/', pagesRoutes);       
app.use('/', authRoutes);        
app.use('/admin', adminRoutes);  
app.use('/api', apiRoutes);      

// --- LANCEMENT DU SERVEUR ---
app.listen(port, () => { 
    console.log(`✅ Serveur BPM lancé sur http://localhost:${port}`); 
});