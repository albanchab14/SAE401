require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.LASTFM_API_KEY;

// Fonction de recherche flexible
async function rechercherAlbums(requete) {
    try {
        console.log(`🔎 Recherche en cours pour : "${requete}"...`);

        // 1. On change la méthode : 'album.search' au lieu de 'artist.getinfo'
        const url = `http://ws.audioscrobbler.com/2.0/?method=album.search&album=${requete}&api_key=${API_KEY}&format=json`;

        const response = await axios.get(url);
        
        // 2. On récupère la LISTE des albums (c'est un tableau [])
        const albums = response.data.results.albummatches.album;

        console.log(`✅ J'ai trouvé ${albums.length} albums ! Voici les 5 premiers :`);
        console.log("---------------------------------------------------");

        // 3. On fait une boucle pour afficher les 5 premiers résultats
        // (Comme une boucle 'for' classique)
        for (let i = 0; i < 5; i++) {
            const album = albums[i];
            
            // Sécurité : on vérifie s'il y a bien un album à cet index
            if (album) {
                console.log(`💿 Titre : ${album.name}`);
                console.log(`🎤 Artiste : ${album.artist}`);
                // L'image est souvent cachée dans un tableau, index 2 = taille moyenne
                console.log(`🖼️ Image : ${album.image[2]['#text']}`); 
                console.log("---");
            }
        }

    } catch (error) {
        console.log("❌ Erreur :", error.message);
    }
}

// TESTE ICI ! Change "Thriller" par ce que tu veux
rechercherAlbums("Thriller");