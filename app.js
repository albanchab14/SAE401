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


// Route pour la page Explorer (Recherche)
app.get('/search', (req, res) => {
    // On simule une recherche pour "The Weeknd"
    const searchResults = [
        { id: '1', title: 'Starboy', artist: 'The Weeknd', type: 'Album', year: '2016', rating: '4.8', image: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=400&h=400&fit=crop' },
        { id: '2', title: 'Random Access Memories', artist: 'Daft Punk', type: 'Album', year: '2013', rating: '4.9', image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&h=400&fit=crop' },
        { id: '3', title: 'After Hours', artist: 'The Weeknd', type: 'Album', year: '2020', rating: '4.7', image: 'https://images.unsplash.com/photo-1621360841013-c76831f1dbce?w=400&h=400&fit=crop' },
        { id: '4', title: 'Motomami', artist: 'Rosalía', type: 'Album', year: '2022', rating: '4.5', image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=400&h=400&fit=crop' }
    ];

    res.render('search.njk', { 
        query: "The Weeknd",
        totalResults: 84,
        results: searchResults 
    });
});


// 5. Lancement du serveur
app.listen(port, () => {
    console.log(`Serveur lancé sur http://localhost:${port}`);
});