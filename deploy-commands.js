const { REST, Routes } = require('discord.js');
const { clientId, guildId, token } = require('./config.json');
const { readdirSync } = require('fs');
const path = require('path');

/**
 * Recursively load all command files from a directory
 * @param {string} dir - Directory to load commands from
 * @param {string[]} [fileList=[]] - List of command files (used for recursion)
 * @returns {Array} Array of command data
 */
function loadCommands(dir, fileList = []) {
    const files = readdirSync(dir, { withFileTypes: true });
    
    for (const file of files) {
        const fullPath = path.join(dir, file.name);
        
        if (file.isDirectory()) {
            // Recursively load commands from subdirectories
            loadCommands(fullPath, fileList);
        } else if (file.name.endsWith('.js') && !file.name.startsWith('_')) {
            try {
                const command = require(fullPath);
                if ('data' in command && 'execute' in command) {
                    fileList.push(command.data.toJSON());
                } else {
                    console.log(`[WARNING] The command at ${fullPath} is missing required "data" or "execute" property.`);
                }
            } catch (error) {
                console.error(`Error loading command ${fullPath}:`, error);
            }
        }
    }
    
    return fileList;
}

// Load all commands
const commands = loadCommands(path.join(__dirname, 'src/commands'));

const rest = new REST().setToken(token);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        // The put method is used to fully refresh all commands in the guild with the current set
        const data = await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );

        console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }
})();
