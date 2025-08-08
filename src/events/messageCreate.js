const { Events } = require('discord.js');
const logger = require('../utils/logger');

// Cache for rate limiting
const messageCooldown = new Map();
const MESSAGE_COOLDOWN_MS = 1000; // 1 second cooldown between counting messages

module.exports = {
    name: Events.MessageCreate,
    once: false,
    
    /**
     * Handles message creation events to track user activity
     * @param {Message} message - The message object
     * @param {RankUpClient} client - The Discord client
     */
    async execute(message, client) {
        try {
            // Ignore messages from bots, DMs, or if the message is a command
            if (message.author.bot || !message.guild || message.content.startsWith('/')) return;

            // Get member with roles
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (!member) return;

            // Get all ranking role IDs from config
            const rankingRoleIds = client.config.permissions.map(perm => perm.roleId);
            
            // Check if user has any of the ranking roles
            const hasRankingRole = member.roles.cache.some(role => rankingRoleIds.includes(role.id));
            if (!hasRankingRole) return;

            // Check rate limiting
            const now = Date.now();
            const cooldownKey = `${message.guild.id}-${message.author.id}`;
            const lastMessageTime = messageCooldown.get(cooldownKey) || 0;
            
            // If the user sent a message recently, ignore it for activity tracking
            if (now - lastMessageTime < MESSAGE_COOLDOWN_MS) {
                return;
            }
            
            // Update the cooldown
            messageCooldown.set(cooldownKey, now);
            
            // Initialize or update user in the database
            try {
                // Track the message using the client's database instance
                await client.db.addMessage(message.author.id);
                
                logger.debug(`Tracked message from ${message.author.tag} (has ranking role)`);
                
                // Get updated user stats for logging (only log every 10 messages to reduce noise)
                const user = await client.db.getUserStats(message.author.id);
                if (user && user.messageCount % 10 === 0) {
                    logger.debug(`User ${message.author.tag} (Ranking Member) has sent ${user.messageCount} messages`);
                }
                
            } catch (error) {
                logger.error(`Error processing message from ${message.author.tag}:`, error);
            }
            
            // Handle commands (if any)
            if (message.content.startsWith(client.config.prefix)) {
                await handleCommand(message, client);
            }
            
        } catch (error) {
            logger.error('Error in messageCreate event:', error);
        }
    },
};

/**
 * Handles command execution
 * @param {Message} message - The message object
 * @param {RankUpClient} client - The Discord client
 */
async function handleCommand(message, client) {
    try {
        const args = message.content.slice(client.config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        
        // Try to find the command by name or alias
        const command = client.commands.get(commandName) || 
                       client.commands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));
        
        if (!command) return;
        
        // Check if the command is guild only
        if (command.guildOnly && !message.guild) {
            return message.reply('This command can only be used in a server.');
        }
        
        // Check user permissions
        if (command.permissions) {
            const authorPerms = message.channel.permissionsFor(message.author);
            if (!authorPerms || !authorPerms.has(command.permissions)) {
                return message.reply('You do not have permission to use this command.');
            }
        }
        
        // Execute the command
        try {
            await command.execute(message, args, client);
        } catch (error) {
            logger.error(`Error executing command ${commandName}:`, error);
            await message.reply({
                content: 'There was an error executing that command!',
                ephemeral: true
            });
        }
        
    } catch (error) {
        logger.error('Error in command handler:', error);
    }
}
