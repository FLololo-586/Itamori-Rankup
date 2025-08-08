const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    SlashCommandBuilder,
    ComponentType
} = require('discord.js');
const logger = require('../../utils/logger');
/**
 * Format time in milliseconds to a human-readable string
 * @param {number} ms - Time in milliseconds
 * @returns {string} Formatted time string
 */
function formatTime(ms) {
    if (!ms || isNaN(ms)) return '0s';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours % 24 > 0) parts.push(`${hours % 24}h`);
    if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
    if (seconds % 60 > 0 || parts.length === 0) parts.push(`${seconds % 60}s`);
    return parts.join(' ');
}
/**
 * Check if a user meets all requirements to rank up
 * @param {Object} user - User data from database
 * @param {Object} nextRank - Next rank configuration
 * @param {Object} config - Bot configuration
 * @returns {Object} Requirements status
 */
function checkRankUpRequirements(user, nextRank, config) {
    const now = Date.now();
    const joinDate = new Date(user.joinDate);
    const daysOnServer = (now - joinDate) / (1000 * 60 * 60 * 24);
    const lastRankUp = user.lastRankUp ? user.lastRankUp * 1000 : 0; 
    const cooldownMs = 48 * 60 * 60 * 1000; 
    const timeSinceLastRankUp = now - lastRankUp;
    const isOnCooldown = lastRankUp > 0 && timeSinceLastRankUp < cooldownMs;
    const voiceHours = (user.totalVoiceMinutes || 0) / 60;
    const messages = user.totalMessages || 0;
    let meetsRequirements;
    if (nextRank.isOrCondition) {
        meetsRequirements = messages >= nextRank.requiredMessages || 
                          voiceHours >= nextRank.requiredVoiceHours;
    } else {
        const meetsMessages = nextRank.requiredMessages === 0 || messages >= nextRank.requiredMessages;
        const meetsVoice = voiceHours >= nextRank.requiredVoiceHours;
        meetsRequirements = meetsMessages && meetsVoice;
    }
    const hasEnoughMessages = user.messageCount >= nextRank.messagesRequired;
    const hasEnoughVoiceTime = (user.totalVoiceMinutes / 60) >= nextRank.voiceHoursRequired;
    const meetsTimeRequirement = daysOnServer >= config.minServerDays;
    return {
        meetsRequirements,
        isOnCooldown,
        cooldownRemaining: Math.max(0, cooldownMs - timeSinceLastRankUp),
        messages: {
            current: messages,
            required: nextRank.requiredMessages,
            progress: Math.min(100, (messages / nextRank.requiredMessages) * 100)
        },
        voice: {
            current: voiceHours,
            required: nextRank.requiredVoiceHours,
            progress: Math.min(100, (voiceHours / nextRank.requiredVoiceHours) * 100)
        },
        joinDate: user.joinDate,
        lastRankUp: user.lastRankUp,
        nextRankId: nextRank.id
    };
}
const data = new SlashCommandBuilder()
    .setName('rankup')
    .setDescription('Vérifiez votre statut de montée de rang et votre progression vers le rang suivant');
/**
 * Execute the rankup command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
 * @param {import('../../index')} client - The Discord client
 */
async function execute(interaction, client) {
        console.log('Début de la commande /rankup');
        try {
            console.log('Vérification de la blacklist...');
            if (!interaction.replied && !interaction.deferred) {
                console.log('Début du différé de la réponse...');
                await interaction.deferReply({ ephemeral: true });
                console.log('Réponse différée avec succès');
            }
            if (await client.db.isBlacklisted(interaction.user.id)) {
                return interaction.editReply({
                    content: '⛔ Vous êtes sur la liste noire et ne pouvez pas utiliser le système de rang.',
                    ephemeral: true
                });
            }
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            console.log(`User ID: ${userId}, Guild ID: ${guildId}`);
            const member = await interaction.guild.members.fetch(userId);
            const hasRequiredRole = member.roles.cache.has(client.config.requiredRoleId);
            const hasAnyPermRole = client.config.permissions.some(perm => 
                member.roles.cache.has(perm.roleId)
            );
            if (!hasRequiredRole && !hasAnyPermRole) {
                return interaction.editReply({
                    content: `❌ Vous devez avoir le rôle <@&${client.config.requiredRoleId}> ou un rôle de permission pour utiliser cette commande.`
                });
            }
            console.log('Récupération des stats utilisateur...');
            const user = await client.db.getUserStats(interaction.user.id);
            console.log('Stats utilisateur récupérées:', user);
            if (!user) {
                return interaction.editReply({
                    content: "You're not registered in the system yet! Send a message first.",
                    ephemeral: true
                });
            }
            let currentRankIndex = -1;
            for (let i = 0; i < client.config.ranks.length; i++) {
                const rank = client.config.ranks[i];
                if (member.roles.cache.has(rank.roleId)) {
                    currentRankIndex = i;
                }
            }
            if (currentRankIndex === -1) {
                currentRankIndex = 0;
                try {
                    await member.roles.add(client.config.ranks[0].roleId, 'Initial rank assignment');
                } catch (error) {
                    console.error('Error assigning initial rank:', error);
                }
            }
            const currentRank = client.config.ranks[currentRankIndex];
            const nextRank = client.config.ranks[currentRankIndex + 1];
            const currentRankRole = interaction.guild.roles.cache.get(currentRank.roleId);
            const nextRankRole = interaction.guild.roles.cache.get(nextRank?.roleId);
            if (!nextRank) {
                const currentRankName = currentRankRole?.name || currentRank.name;
                return interaction.editReply({
                    content: `🎉 Félicitations ! Vous avez atteint le rang maximum: **${currentRankName}**`,
                    ephemeral: true
                });
            }
            const requirements = checkRankUpRequirements(user, nextRank, client.config);
            const nextRankName = nextRankRole?.name || nextRank.name;
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`Progression vers ${nextRankName}`)
                .setDescription(`Voici votre progression pour atteindre le rang **${nextRankName}**`)
                .addFields(
                    { 
                        name: '📝 Messages', 
                        value: `${requirements.messages.current} / ${requirements.messages.required} (${requirements.messages.progress.toFixed(1)}%)`,
                        inline: true 
                    },
                    { 
                        name: '🎤 Heures de vocal', 
                        value: `${requirements.voice.current.toFixed(1)}h / ${requirements.voice.required}h (${requirements.voice.progress.toFixed(1)}%)`,
                        inline: true 
                    },
                    {
                        name: '⏱️ Prochain rank-up possible',
                        value: requirements.isOnCooldown 
                            ? `⏳ Vous pourrez rank up à nouveau dans ${formatTime(requirements.cooldownRemaining)}`
                            : '✅ Vous pouvez rank up maintenant !',
                        inline: false
                    }
                )
                .setTimestamp();
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('rankup_button')
                    .setLabel('Rank Up!')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⬆️')
                    .setDisabled(!requirements.meetsRequirements || requirements.isOnCooldown)
            );
            await interaction.editReply({
                embeds: [embed],
                components: [row],
                ephemeral: true
            });
        } catch (error) {
            console.error('Erreur dans la commande /rankup:', error);
            if (interaction.deferred || interaction.replied) {
                try {
                    await interaction.editReply({
                        content: '❌ Une erreur est survenue lors du traitement de votre demande. Veuillez réessayer plus tard.',
                        embeds: [],
                        components: []
                    });
                } catch (e) {
                    console.error('Erreur lors de l\'envoi du message d\'erreur:', e);
                }
            } else {
                try {
                    await interaction.reply({
                        content: '❌ Une erreur est survenue lors du traitement de votre demande. Veuillez réessayer plus tard.',
                        ephemeral: true
                    });
                } catch (e) {
                    console.error('Impossible d\'envoyer le message d\'erreur:', e);
                }
            }
        }
    }
/**
 * Handle the rank up process
 * @param {import('discord.js').ButtonInteraction} interaction - The button interaction
 * @param {import('../../index')} client - The Discord client
 * @param {Object} user - User data from database
 * @param {Object} currentRank - Current rank configuration
 * @param {Object} nextRank - Next rank configuration
 */
async function handleRankUp(interaction, client, user, currentRank, nextRank) {
    try {
        await interaction.deferUpdate();
        const requirements = checkRankUpRequirements(
            await client.db.getUserStats(interaction.user.id),
            nextRank,
            client.config
        );
        if (!(requirements.hasEnoughMessages || requirements.hasEnoughVoiceTime) || 
            !requirements.meetsTimeRequirement || 
            requirements.isOnCooldown) {
            return interaction.followUp({
                content: 'You no longer meet the requirements to rank up. Please check your status again.',
                ephemeral: true
            });
        }
        const member = interaction.guild.members.cache.get(interaction.user.id) || 
                      await interaction.guild.members.fetch(interaction.user.id);
        const rankRoleIds = client.config.ranks.map(rank => rank.roleId);
        if (nextRank.roleId) {
            try {
                await member.roles.add(nextRank.roleId, 'Rank up');
                const rolesToRemove = rankRoleIds.filter(id => id !== nextRank.roleId);
                if (rolesToRemove.length > 0) {
                    await member.roles.remove(rolesToRemove, 'Rank up - removing previous ranks');
                }
                const currentPermissionId = nextRank.permissionId;
                const permissionRolesToRemove = client.config.permissions
                    .filter(p => p.id !== currentPermissionId)
                    .map(p => p.roleId);
                if (permissionRolesToRemove.length > 0) {
                    await member.roles.remove(permissionRolesToRemove, 'Rank up - updating permissions');
                }
            } catch (roleError) {
                logger.error('Error updating roles:', roleError);
            }
        }
        const successEmbed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('🎉 Rank Up Successful!')
            .setDescription(`Congratulations ${interaction.user.toString()}, you are now a **${nextRank.name}**!`)
            .addFields(
                { name: 'Previous Rank', value: currentRank.name, inline: true },
                { name: 'New Rank', value: nextRank.name, inline: true },
                { name: 'New Rank', value: nextRank.name, inline: true }
            )
            .setThumbnail(interaction.user.displayAvatarURL({ size: 256, dynamic: true }))
            .setTimestamp();
        await interaction.followUp({
            content: `${interaction.user.toString()} has ranked up to **${nextRank.name}**!`,
            embeds: [successEmbed]
        });
        logger.info(`User ${interaction.user.tag} (${interaction.user.id}) ranked up to ${nextRank.name} (Level ${user.currentRank + 1})`);
    } catch (error) {
        logger.error('Error in handleRankUp:', error);
        await interaction.followUp({
            content: 'An error occurred while processing your rank up. Please try again later.',
            ephemeral: true
        });
    }
}
module.exports = {
    data,
    execute,
    handleRankUp,
    checkRankUpRequirements
};