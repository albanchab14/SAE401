const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
require('dotenv').config();

// 1. Création de l'application (C'est ça qui manquait !)
const app = express();
const port = 3000;

// 2. Configuration de Nunjucks (pour tes fichiers .njk)
nunjucks.configure('views', {
    autoescape: true,
    express: app
});

// 3. Configuration des fichiers statiques (pour ton CSS)
// Cela permet d'accéder à ce qui est dans le dossier 'public'
app.use(express.static(path.join(__dirname, 'public')));

// 4. TA ROUTE D'ACCUEIL (Celle qu'on a faite ensemble)
app.get('/', (req, res) => {
    // Données simulées (en attendant l'API Last.fm)
    const topArtists = [
        { id: '1', name: 'The Weeknd', image: 'https://images.unsplash.com/photo-1604618504394-bf572163ec23', listeners: '84.2M' },
        { id: '2', name: 'Daft Punk', image: 'https://images.unsplash.com/photo-1768141741309-195919725562', listeners: '32.5M' },
        { id: '3', name: 'Rosalía', image: 'https://images.unsplash.com/photo-1618613403887-ed08ea9f8f6e', listeners: '28.1M' },
        { id: '4', name: 'Frank Ocean', image: 'https://images.unsplash.com/photo-1643236294618-d60e33412802', listeners: '22.9M' },
        { id: '5', name: 'Tame Impala', image: 'https://images.unsplash.com/photo-1762160773080-f7e052aec406', listeners: '19.4M' },
        { id: '6', name: 'Kaytranada', image: 'https://images.unsplash.com/photo-1768885512408-7bd6eb726025', listeners: '15.8M' },
    ];

    res.render('index.njk', { 
        topArtists: topArtists,
        heroArtist: topArtists[0] 
    });
});


app.get('/connexion', (req, res) => {
    res.render('login.njk');
});

// 5. Lancement du serveur
app.listen(port, () => {
    console.log(`Serveur lancé sur http://localhost:${port}`);
});