const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../src/config/database');

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/login');
    }
    next();
}

async function getRealArtistImage(artistName) {
    try {
        const cleanName = artistName.split(',')[0].split('&')[0].trim();
        const resp = await axios.get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName)}`);
        if (resp.data && resp.data.data && resp.data.data.length > 0) {
            let img = resp.data.data[0].picture_xl;
            if (img && !img.includes('/images/artist//')) return img;
        }
    } catch (e) {}
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(artistName)}&background=d946ef&color=fff&size=500`;
}

router.get('/', requireAdmin, async (req, res) => {
    try {
        const [settings] = await db.query('SELECT is_maintenance FROM site_settings WHERE id = 1');
        const isMaintenance = settings.length > 0 ? settings[0].is_maintenance : false;
        const [users] = await db.query("SELECT id, pseudo, email, role, is_banned FROM users ORDER BY id DESC LIMIT 50");
        const [reports] = await db.query(`SELECT c.id as comment_id, u.pseudo, c.commentaire as comment, c.music_item_id, c.item_type, rc.reason, COUNT(rc.id) as count FROM reports_commentaire rc JOIN commentaires c ON rc.commentaire_id = c.id JOIN users u ON c.user_id = u.id GROUP BY c.id, u.pseudo, c.commentaire, c.music_item_id, c.item_type, rc.reason ORDER BY count DESC`);
        
        reports.forEach(r => {
            const itemId = r.music_item_id ? r.music_item_id.trim() : '';
            if (r.item_type === 'track') { r.url = '/details/' + encodeURIComponent(itemId); } 
            else if (r.item_type === 'artist') { r.url = '/artiste/' + encodeURIComponent(itemId); } 
            else if (r.item_type === 'album') {
                let artist = "Inconnu"; let title = itemId;
                if (itemId.includes('::')) { let parts = itemId.split('::'); artist = parts[0].trim(); title = parts[1].trim(); }
                else if (itemId.includes('-')) { let parts = itemId.split('-'); artist = parts[0].trim(); title = parts.slice(1).join('-').trim(); }
                r.url = '/album/' + encodeURIComponent(artist) + '/' + encodeURIComponent(title);
            } else {
                r.url = '/search?q=' + encodeURIComponent(itemId);
            }
        });

        const [dbArtists] = await db.query("SELECT * FROM featured_artists ORDER BY rang ASC, id ASC LIMIT 6");
        let featuredArtists = [];
        for (let i = 0; i < dbArtists.length; i++) {
            const a = dbArtists[i];
            featuredArtists.push({ db_id: a.id, position: a.rang, name: a.api_artist_id, image: await getRealArtistImage(a.api_artist_id), desc: a.accroche || "" });
        }

        const [[{ totalU }]] = await db.query("SELECT COUNT(*) as totalU FROM users");
        const [[{ totalC }]] = await db.query("SELECT COUNT(*) as totalC FROM commentaires");
        const [[{ totalR }]] = await db.query("SELECT COUNT(*) as totalR FROM reports_commentaire");

        res.render('admin.njk', { page: 'admin', users, reports, featuredArtists, isMaintenance, stats: { users: totalU.toLocaleString('fr-FR'), comments: totalC.toLocaleString('fr-FR'), reports: totalR, artists: featuredArtists.length } });
    } catch (error) { res.status(500).send("Erreur serveur Dashboard."); }
});

module.exports = router;