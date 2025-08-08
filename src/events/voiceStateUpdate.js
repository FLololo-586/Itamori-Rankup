const { Events } = require('discord.js');
const logger = require('../utils/logger');

// Store join times for users in voice channels
const voiceJoinTimes = new Map();

// Voice activity tracking configuration
const VOICE_ACTIVITY = {
    MIN_SESSION_LENGTH: 60 * 1000 // 1 minute minimum session length
};

console.log('🎤 voiceStateUpdate.js file loaded!');

module.exports = {
    name: Events.VoiceStateUpdate,
    once: false,
    
    /**
     * Handles voice state updates to track voice channel activity
     * @param {VoiceState} oldState - The voice state before the update
     * @param {VoiceState} newState - The voice state after the update
     * @param {RankUpClient} client - The Discord client
     */
    async execute(oldState, newState, client) {
        console.log('🎤 VOICE STATE UPDATE EXECUTE CALLED!');
        try {
            logger.info(`🎤 Voice state update detected for user: ${newState.member?.user?.tag || 'Unknown'}`);            
            const { member } = newState;
            const userId = member.id;
            const now = Date.now();
            
            // Ignore if the user is a bot
            if (member.user.bot) {
                logger.debug(`Ignoring bot user: ${member.user.tag}`);
                return;
            }
            
            // Get all ranking role IDs from config
            const rankingRoleIds = client.config.permissions.map(perm => perm.roleId);
            
            // Check if user has any of the ranking roles
            const hasRankingRole = member.roles.cache.some(role => rankingRoleIds.includes(role.id));
            if (!hasRankingRole) {
                logger.debug(`Ignoring voice activity for ${member.user.tag} (no ranking role)`);
                return;
            }
            
            // Get or create user in the database
            let user = await client.db.getUser(userId);
            if (!user) {
                user = await client.db.createUser(userId, member.joinedTimestamp || now);
                logger.debug(`Created new user entry for ranking member ${member.user.tag} during voice state update`);
            }
            
            // User joined a voice channel
            if (!oldState.channelId && newState.channelId) {
                voiceJoinTimes.set(userId, now);
                logger.info(`🔊 ${member.user.tag} a rejoint le salon vocal "${newState.channel.name}"`);
            } 
            // User left a voice channel
            else if (oldState.channelId && !newState.channelId) {
                const joinTime = voiceJoinTimes.get(userId);
                if (joinTime) {
                    const duration = now - joinTime;
                    if (duration >= VOICE_ACTIVITY.MIN_SESSION_LENGTH) {
                        try {
                            await client.db.addVoiceTime(userId, Math.floor(duration / 60000)); // Convert to minutes
                            logger.info(`🔇 ${member.user.tag} a quitté le vocal après ${Math.floor(duration / 60000)} minutes`);
                        } catch (error) {
                            logger.error(`Error updating voice time for ${member.user.tag}:`, error);
                        }
                    }
                    voiceJoinTimes.delete(userId);
                }
            }
            // User moved between channels
            else if (oldState.channelId !== newState.channelId) {
                logger.info(`🔄 ${member.user.tag} a changé pour le salon vocal "${newState.channel?.name}"`);
                // Update join time for the new channel
                voiceJoinTimes.set(userId, now);
            }
            
        } catch (error) {
            logger.error('Error in voiceStateUpdate event:', error);
        }
    }
};
