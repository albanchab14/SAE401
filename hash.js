const bcrypt = require('bcrypt');

async function genererHash() {
    const hashAzerty = await bcrypt.hash('azerty', 10);
    const hashAdmin = await bcrypt.hash('mdpadmin', 10);
    
    console.log("=== TES VRAIS HASHS SONT LÀ ===");
    console.log("Pour 'azerty'   : ", hashAzerty);
    console.log("Pour 'mdpadmin' : ", hashAdmin);
}

genererHash();