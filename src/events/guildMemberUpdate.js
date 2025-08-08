const { Events } = require('discord.js');
const logger = require('../utils/logger');
module.exports = {
    name: Events.GuildMemberUpdate,
    once: false,
    /**
     * Handles guild member updates to automatically assign permission roles
     * @param {GuildMember} oldMember - The member before the update
     * @param {GuildMember} newMember - The member after the update
     * @param {RankUpClient} client - The Discord client
     */
    async execute(oldMember, newMember, client) {
        try {
            const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
            if (addedRoles.size === 0) return; 
            for (const [roleId, role] of addedRoles) {
                const rank = client.config.ranks.find(r => r.roleId === roleId);
                if (rank && rank.permissionId) {
                    const permission = client.config.permissions.find(p => p.id === rank.permissionId);
                    if (permission && permission.roleId) {
                        try {
                            if (!newMember.roles.cache.has(permission.roleId)) {
                                await newMember.roles.add(permission.roleId, `Auto-assigned permission role for rank: ${rank.name}`);
                                logger.info(`Auto-assigned permission role <@&${permission.roleId}> to ${newMember.user.tag} for receiving rank role <@&${rank.roleId}>`);
                            }
                        } catch (error) {
                            logger.error(`Failed to assign permission role "${permission.name}" to ${newMember.user.tag}:`, error);
                        }
                    }
                }
            }
        } catch (error) {
            logger.error('Error in guildMemberUpdate event:', error);
        }
    }
};