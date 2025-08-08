const { Events } = require('discord.js');
const logger = require('../utils/logger');
const messageCooldown = new Map();
const MESSAGE_COOLDOWN_MS = 1000; 
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
            if (message.author.bot || !message.guild || message.content.startsWith('/')) return;
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (!member) return;
            const rankingRoleIds = client.config.permissions.map(perm => perm.roleId);
            const hasRankingRole = member.roles.cache.some(role => rankingRoleIds.includes(role.id));
            if (!hasRankingRole) return;
            const now = Date.now();
            const cooldownKey = `${message.guild.id}-${message.author.id}`;
            const lastMessageTime = messageCooldown.get(cooldownKey) || 0;
            if (now - lastMessageTime < MESSAGE_COOLDOWN_MS) {
                return;
            }
            messageCooldown.set(cooldownKey, now);
            try {
                await client.db.addMessage(message.author.id);
                logger.debug(`Tracked message from ${message.author.tag} (has ranking role)`);
                const user = await client.db.getUserStats(message.author.id);
                if (user && user.messageCount % 10 === 0) {
                    logger.debug(`User ${message.author.tag} (Ranking Member) has sent ${user.messageCount} messages`);
                }
            } catch (error) {
                logger.error(`Error processing message from ${message.author.tag}:`, error);
            }
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
        const command = client.commands.get(commandName) || 
                       client.commands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));
        if (!command) return;
        if (command.guildOnly && !message.guild) {
            return message.reply('This command can only be used in a server.');
        }
        if (command.permissions) {
            const authorPerms = message.channel.permissionsFor(message.author);
            if (!authorPerms || !authorPerms.has(command.permissions)) {
                return message.reply('You do not have permission to use this command.');
            }
        }
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