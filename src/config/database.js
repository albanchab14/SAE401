const mysql = require('mysql2');
require('dotenv').config(); // Pour lire ton fichier .env

// On crée une connexion intelligente (Pool)
// Ça permet d'avoir plusieurs utilisateurs connectés en même temps sans planter
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// On exporte la version "promise" pour pouvoir utiliser "await" (plus moderne)
module.exports = pool.promise();