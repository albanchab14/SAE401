const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../src/config/database');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');

// CONFIGURATION UPLOAD AVATAR
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'public/images/') },
    filename: function (req, file, cb) { cb(null, 'avatar-' + Date.now() + path.extname(file.originalname)) }
});
const upload = multer({ storage: storage });

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: "Accès refusé." });
    }
    next();
}

// --- API : PROFIL ---
router.post('/profil/edit', upload.single('avatar'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Non connecté" });
    try {
        const { pseudo, email, bio, password } = req.body;
        const userId = req.session.user.id;
        const cleanEmail = email.replace(/\s+/g, '');

        let updateQuery = "UPDATE users SET pseudo = ?, email = ?, bio = ? WHERE id = ?";
        let queryParams = [pseudo, cleanEmail, bio, userId];

        if (req.file) {
            const avatarPath = '/images/' + req.file.filename;
            await db.query("UPDATE users SET avatar = ? WHERE id = ?", [avatarPath, userId]);
            req.session.user.avatar = avatarPath;
        }

        if (password && password.trim() !== "") {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateQuery = "UPDATE users SET pseudo = ?, email = ?, bio = ?, password = ? WHERE id = ?";
            queryParams = [pseudo, cleanEmail, bio, hashedPassword, userId];
        }

        await db.query(updateQuery, queryParams);
        req.session.user.pseudo = pseudo;
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur : Ce pseudo ou cet email est peut-être déjà utilisé." }); }
});

router.delete('/profil/delete', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Non connecté" });
    try {
        await db.query("DELETE FROM users WHERE id = ?", [req.session.user.id]);
        req.session.destroy();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur" }); }
});

// --- API : RECHERCHE ET DÉCOUVERTE ---
router.get('/search-users', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);
        const [users] = await db.query('SELECT pseudo, avatar FROM users WHERE pseudo LIKE ? LIMIT 5', [`%${q}%`]);
        res.json(users);
    } catch (e) { res.status(500).json({ error: "Erreur" }); }
});

router.get('/match', async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const matchTags = ['pop', 'rock', 'hip-hop', 'electronic', 'indie', 'alternative', 'rnb', 'jazz', 'soul'];
        const randTag = matchTags[Math.floor(Math.random() * matchTags.length)];
        const randPage = Math.floor(Math.random() * 10) + 1; 
        
        const response = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=tag.gettopalbums&tag=${randTag}&api_key=${API_KEY}&format=json&limit=30&page=${randPage}`);
        let albums = response.data.albums.album || [];
        albums = albums.sort(() => 0.5 - Math.random());
        const result = [];
        const seenArtists = new Set();
        
        for (let alb of albums) {
            let img = alb.image ? alb.image[3]['#text'] : null;
            if (img && !img.includes('2a96cbd8') && !seenArtists.has(alb.artist.name)) {
                result.push({ title: alb.name, artist: alb.artist.name, image: img });
                seenArtists.add(alb.artist.name);
            }
            if (result.length === 3) break;
        }
        res.json(result);
    } catch (error) { res.status(500).json({ error: "Erreur Match" }); }
});

router.get('/suggest', async (req, res) => {
    try {
        const { q } = req.query;
        const API_KEY = process.env.LASTFM_API_KEY;
        if (!q || q.length < 2) return res.json([]);

        const [artResp, albResp] = await Promise.all([
            axios.get(`https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=4`),
            axios.get(`https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodeURIComponent(q)}&api_key=${API_KEY}&format=json&limit=4`)
        ]);

        let deezerArtists = artResp.data.data || [];
        deezerArtists = deezerArtists.filter(a => !((a.name.includes('&') || a.name.includes(' feat')) && !q.includes('&')));
        const artists = deezerArtists.slice(0, 4).map(a => ({ title: a.name, artist: "Artiste", type: "artiste" }));
        const albums = albResp.data.results.albummatches.album.map(a => ({ title: a.name, artist: a.artist, type: "album" }));
        
        res.json([...artists, ...albums]);
    } catch (e) { res.json([]); }
});

// --- API : FAVORIS ET COMMENTAIRES ---
router.post('/favorites/toggle', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous." });
    try {
        const { music_id } = req.body;
        const userId = req.session.user.id;
        const [exist] = await db.query("SELECT * FROM favorites WHERE user_id = ? AND music_id = ?", [userId, music_id]);
        if (exist.length > 0) {
            await db.query("DELETE FROM favorites WHERE user_id = ? AND music_id = ?", [userId, music_id]);
            res.json({ isFavorite: false });
        } else {
            await db.query("INSERT INTO favorites (user_id, music_id) VALUES (?, ?)", [userId, music_id]);
            res.json({ isFavorite: true });
        }
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.post('/comments', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous pour commenter." });
    try {
        const { item_id, item_type, note, commentaire } = req.body;
        await db.query("INSERT INTO commentaires (user_id, music_item_id, item_type, note, commentaire) VALUES (?, ?, ?, ?, ?)", 
        [req.session.user.id, item_id, item_type, note, commentaire]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur lors de l'envoi." }); }
});

router.post('/comments/:id/like', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous." });
    try {
        const commentId = req.params.id;
        const userId = req.session.user.id; 
        const [exist] = await db.query("SELECT * FROM comment_likes WHERE user_id = ? AND comment_id = ?", [userId, commentId]);
        
        if (exist.length > 0) {
            await db.query("DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?", [userId, commentId]);
            res.json({ liked: false });
        } else {
            await db.query("INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)", [userId, commentId]);
            const [comments] = await db.query("SELECT user_id, music_item_id FROM commentaires WHERE id = ?", [commentId]);
            if (comments.length > 0) {
                const authorId = comments[0].user_id;
                const reference = comments[0].music_item_id;
                if (userId !== authorId) {
                    await db.query(`INSERT INTO notifications (user_id, actor_id, type, reference, date_creation) VALUES (?, ?, 'like', ?, ?)`, [authorId, userId, reference, new Date()]);
                }
            }
            res.json({ liked: true });
        }
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.post('/comments/:id/report', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous." });
    try {
        const { reason } = req.body;
        await db.query("INSERT INTO reports_commentaire (reporter_id, commentaire_id, reason) VALUES (?, ?, ?)", 
        [req.session.user.id, req.params.id, reason]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.delete('/comments/own/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous." });
    try {
        await db.query("DELETE FROM commentaires WHERE id = ? AND user_id = ?", [req.params.id, req.session.user.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.put('/comments/own/:id', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous." });
    try {
        const { note, commentaire } = req.body;
        await db.query("UPDATE commentaires SET note = ?, commentaire = ?, date_commentaire = NOW() WHERE id = ? AND user_id = ?", 
        [note, commentaire, req.params.id, req.session.user.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

// --- API : UTILISATEURS ET ABONNEMENTS ---
router.get('/user/:id/followers', async (req, res) => {
    try {
        const [followers] = await db.query(`
            SELECT u.pseudo, u.avatar, f.follower_id 
            FROM users u
            JOIN follows f ON u.id = f.follower_id
            WHERE f.following_id = ?
        `, [req.params.id]);
        res.json(followers || []);
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.delete('/user/followers/:followerId', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Non connecté" });
    try {
        await db.query("DELETE FROM follows WHERE follower_id = ? AND following_id = ?", [req.params.followerId, req.session.user.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.post('/user/:id/follow', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Connectez-vous" });
    const followerId = req.session.user.id;
    const followingId = req.params.id;
    
    if (followerId == followingId) return res.json({ error: "Auto-follow" });

    try {
        const [exist] = await db.query("SELECT * FROM follows WHERE follower_id = ? AND following_id = ?", [followerId, followingId]);
        if (exist.length > 0) {
            // Désabonnement
            await db.query("DELETE FROM follows WHERE follower_id = ? AND following_id = ?", [followerId, followingId]);
            res.json({ isFollowing: false });
        } else {
            // Abonnement
            await db.query("INSERT INTO follows (follower_id, following_id) VALUES (?, ?)", [followerId, followingId]);
            
            // ✨ LE TEST DE NOTIFICATION ✨
            try {
                // J'ai rajouté "reference" avec la valeur NULL pour éviter les bugs SQL
                await db.query(`
                    INSERT INTO notifications (user_id, actor_id, type, reference, date_creation) 
                    VALUES (?, ?, 'follow', NULL, ?)
                `, [followingId, followerId, new Date()]);
                console.log("✅ Notification de follow insérée dans la BDD avec succès !");
            } catch (notifError) {
                console.error("❌ Erreur SQL lors de la notification :", notifError.message);
            }
            
            res.json({ isFollowing: true });
        }
    } catch (e) { 
        console.error("Erreur globale Follow:", e);
        res.status(500).json({ error: "Erreur BDD" }); 
    }
});

// --- API ADMIN : GESTION DU SITE ---
// NOUVELLE ROUTE : MODIFIER UN UTILISATEUR MANUELLEMENT
router.post('/admin/users/:id/edit', requireAdmin, async (req, res) => {
    try {
        const { pseudo, email, password } = req.body;
        const userId = req.params.id;

        let updateQuery = "UPDATE users SET pseudo = ?, email = ? WHERE id = ?";
        let queryParams = [pseudo, email, userId];

        // Si l'admin a tapé un nouveau mot de passe, on le hash et on l'ajoute à la requête
        if (password && password.trim() !== "") {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateQuery = "UPDATE users SET pseudo = ?, email = ?, password = ? WHERE id = ?";
            queryParams = [pseudo, email, hashedPassword, userId];
        }

        await db.query(updateQuery, queryParams);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: "Erreur BDD : Ce pseudo ou email est peut-être déjà pris." });
    }
});



router.post('/admin/maintenance', requireAdmin, async (req, res) => {
    try { await db.query("UPDATE site_settings SET is_maintenance = ? WHERE id = 1", [req.body.active ? 1 : 0]); res.json({ success: true }); } 
    catch (e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.post('/admin/reports/:id/ignore', requireAdmin, async (req, res) => {
    try {
        await db.query("DELETE FROM reports_commentaire WHERE commentaire_id = ?", [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.delete('/admin/comments/:id', requireAdmin, async (req, res) => {
    try {
        await db.query("DELETE FROM reports_commentaire WHERE commentaire_id = ?", [req.params.id]);
        await db.query("DELETE FROM commentaires WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.post('/admin/users/:id/role', requireAdmin, async (req, res) => {
    try {
        await db.query("UPDATE users SET role = ? WHERE id = ?", [req.body.role, req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.post('/admin/users/:id/ban', requireAdmin, async (req, res) => {
    try {
        const [user] = await db.query("SELECT is_banned FROM users WHERE id = ?", [req.params.id]);
        const newStatus = user[0].is_banned ? 0 : 1;
        await db.query("UPDATE users SET is_banned = ? WHERE id = ?", [newStatus, req.params.id]);
        res.json({ is_banned: newStatus });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.delete('/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        await db.query("DELETE FROM users WHERE id = ?", [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.post('/admin/artists/description', requireAdmin, async (req, res) => {
    try {
        await db.query("UPDATE featured_artists SET accroche = ? WHERE id = ?", [req.body.desc, req.body.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.post('/admin/artists/reorder', requireAdmin, async (req, res) => {
    try {
        const targetId = req.body.id;
        const newPosition = parseInt(req.body.newPosition);
        const [currentArtist] = await db.query("SELECT rang FROM featured_artists WHERE id = ?", [targetId]);
        if (currentArtist.length === 0) return res.status(404).json({ error: "Artiste introuvable" });
        const oldPosition = currentArtist[0].rang;
        const [otherArtist] = await db.query("SELECT id FROM featured_artists WHERE rang = ?", [newPosition]);
        if (otherArtist.length > 0) {
            await db.query("UPDATE featured_artists SET rang = ? WHERE id = ?", [oldPosition, otherArtist[0].id]);
        }
        await db.query("UPDATE featured_artists SET rang = ? WHERE id = ?", [newPosition, targetId]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

router.post('/admin/artists/:id/randomize', requireAdmin, async (req, res) => {
    try {
        const API_KEY = process.env.LASTFM_API_KEY;
        const [currentArtists] = await db.query("SELECT api_artist_id FROM featured_artists");
        const existingNames = currentArtists.map(a => a.api_artist_id.toLowerCase());
        const response = await axios.get(`https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&api_key=${API_KEY}&format=json&limit=50`);
        const topArtists = response.data.artists.artist;
        const availableArtists = topArtists.filter(a => !existingNames.includes(a.name.toLowerCase()));
        if (availableArtists.length === 0) return res.status(400).json({ error: "Impossible de trouver un nouvel artiste." });
        const randomArtist = availableArtists[Math.floor(Math.random() * availableArtists.length)].name;
        await db.query("UPDATE featured_artists SET api_artist_id = ? WHERE id = ?", [randomArtist, req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur lors du remplacement." }); }
});

router.post('/admin/artists/replace', requireAdmin, async (req, res) => {
    try {
        await db.query("UPDATE featured_artists SET api_artist_id = ? WHERE id = ?", [req.body.newArtistName, req.body.oldArtistId]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: "Erreur BDD" }); }
});

module.exports = router;