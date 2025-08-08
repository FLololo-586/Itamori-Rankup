const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
/**
 * Format time in minutes to a human-readable string
 * @param {number} minutes - Total minutes
 * @returns {string} Formatted time string
 */
function formatTime(minutes) {
    if (!minutes || isNaN(minutes)) return '0m';
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    const remainingMinutes = Math.round(minutes % 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (remainingHours > 0) parts.push(`${remainingHours}h`);
    if (remainingMinutes > 0 || parts.length === 0) parts.push(`${remainingMinutes}m`);
    return parts.join(' ');
}
/**
 * Find user's current rank based on their roles
 * @param {GuildMember} member - The guild member
 * @param {Array} ranks - Array of rank configurations
 * @returns {Object} The highest rank the user has
 */
function findUserRank(member, ranks) {
    const sortedRanks = [...ranks].sort((a, b) => b.id - a.id);
    const userRank = sortedRanks.find(rank => 
        member.roles.cache.has(rank.roleId)
    );
    return userRank || (ranks.length > 0 ? ranks[0] : null);
}
/**
 * Calculate progress towards the next rank
 * @param {Object} user - User data from database
 * @param {Array} ranks - Array of rank configurations
 * @param {GuildMember} member - The guild member
 * @returns {Object} Progress information
 */
function calculateRankProgress(user, ranks, member) {
    const currentRank = findUserRank(member, ranks);
    if (!currentRank) {
        return {
            hasNextRank: false,
            currentRank: null,
            nextRank: null,
            progress: 0,
            remainingMessages: 0,
            remainingVoiceHours: 0
        };
    }
    const currentRankIndex = ranks.findIndex(r => r.id === currentRank.id);
    const nextRank = currentRankIndex < ranks.length - 1 ? ranks[currentRankIndex + 1] : null;
    if (!nextRank) {
        return {
            hasNextRank: false,
            currentRank,
            nextRank: null,
            progress: 100,
            remainingMessages: 0,
            remainingVoiceHours: 0
        };
    }
    const messagesRequired = nextRank.requiredMessages || 0;
    const voiceHoursRequired = nextRank.requiredVoiceHours || 0;
    const messagesProgress = messagesRequired > 0 
        ? Math.min(100, Math.floor(((user.totalMessages || 0) / messagesRequired) * 100))
        : 100;
    const voiceProgress = voiceHoursRequired > 0 
        ? Math.min(100, Math.floor(((user.totalVoiceMinutes || 0) / 60 / voiceHoursRequired) * 100))
        : 100;
    const progress = Math.min(messagesProgress, voiceProgress);
    return {
        hasNextRank: true,
        currentRank,
        nextRank,
        progress,
        remainingMessages: Math.max(0, messagesRequired - user.totalMessages),
        remainingVoiceHours: Math.max(0, voiceHoursRequired - (user.totalVoiceMinutes / 60))
    };
}
const data = new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Vérifiez votre rang actuel et vos statistiques')
    .addUserOption(option =>
        option.setName('utilisateur')
            .setDescription('Utilisateur dont vérifier le rang (optionnel)')
            .setRequired(false)
    );
/**
 * Execute the rank command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
 * @param {import('../../index')} client - The Discord client
 */
async function execute(interaction, client) {
        if (interaction.replied || interaction.deferred) {
            return;
        }
        try {
            await interaction.deferReply({ ephemeral: true });
            const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
            const member = interaction.guild?.members.cache.get(targetUser.id) || 
                await interaction.guild?.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return interaction.editReply('Impossible de récupérer les informations du membre.');
            }
            const user = await client.db.getUserStats(targetUser.id);
            if (!user) {
                return interaction.editReply({
                    content: targetUser.id === interaction.user.id 
                        ? "Vous n'êtes pas encore enregistré dans le système ! Envoyez d'abord un message." 
                        : "Cet utilisateur n'a pas encore envoyé de messages.",
                    ephemeral: true
                });
            }
            const rankProgress = calculateRankProgress(user, client.config.ranks, member);
            const { currentRank, nextRank, progress } = rankProgress;
            if (!currentRank) {
                return interaction.editReply({
                    content: 'Aucun rang trouvé pour cet utilisateur.',
                    ephemeral: true
                });
            }
            const currentRankRole = interaction.guild.roles.cache.get(currentRank.roleId);
            const currentRankName = currentRankRole ? currentRankRole.name : currentRank.name;
            const progressBarLength = 20;
            const filledSquares = Math.round((progress / 100) * progressBarLength);
            const emptySquares = progressBarLength - filledSquares;
            const progressBar = '▰'.repeat(filledSquares) + '▱'.repeat(emptySquares);
            const embed = new EmbedBuilder()
                .setColor(member.displayHexColor || '#0099ff')
                .setAuthor({
                    name: `Rang de ${member.displayName}`,
                    iconURL: member.displayAvatarURL({ dynamic: true })
                })
                .setThumbnail(member.displayAvatarURL({ size: 256, dynamic: true }))
                .addFields(
                    { 
                        name: 'Rang', 
                        value: `${currentRankName}\n<@&${currentRank.roleId}>`,
                        inline: true 
                    },
                    { 
                        name: 'Messages', 
                        value: user.messageCount.toLocaleString(),
                        inline: true 
                    },
                    { 
                        name: 'Temps vocal', 
                        value: formatTime(user.totalVoiceMinutes),
                        inline: true 
                    },
                    { 
                        name: 'Membre depuis', 
                        value: `<t:${Math.floor(new Date(user.joinDate).getTime() / 1000)}:D>`,
                        inline: true 
                    }
                )
                .setFooter({ 
                    text: `Demandé par ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL() 
                })
                .setTimestamp();
            if (rankProgress.hasNextRank) {
                const messagesRequired = nextRank.requiredMessages || 0;
                const voiceHoursRequired = nextRank.requiredVoiceHours || 0;
                const nextRankRole = interaction.guild.roles.cache.get(nextRank.roleId);
                const nextRankName = nextRankRole ? nextRankRole.name : nextRank.name;
                embed.addFields({
                    name: `Progression vers ${nextRankName}`,
                    value: `${progressBar} ${progress}%\n` +
                           `🌐 ${user.totalMessages.toLocaleString()} messages (${user.totalMessages}/${messagesRequired} requis)\n` +
                           `🎙️ ${(user.totalVoiceMinutes / 60).toFixed(1)}h (${(user.totalVoiceMinutes / 60).toFixed(1)}h/${voiceHoursRequired}h requis)\n` +
                           `🎯 Objectif: <@&${nextRank.roleId}>`
                });
            } else {
                embed.addFields({
                    name: 'Statut du rang',
                    value: '🎉 Vous avez atteint le rang le plus élevé !',
                    inline: false
                });
            }
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            logger.error('Error in rank command:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'Une erreur s\'est produite lors du traitement de votre demande.',
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: 'Une erreur s\'est produite lors du traitement de votre demande.',
                    ephemeral: true
                });
            }
        }
}
const aliases = ['level', 'stats'];
module.exports = {
    data,
    execute,
    aliases
};