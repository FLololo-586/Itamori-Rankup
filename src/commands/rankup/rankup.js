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
    
    // Check cooldown - convert lastRankUp from seconds to milliseconds
    const lastRankUp = user.lastRankUp ? user.lastRankUp * 1000 : 0; // Convert seconds to milliseconds
    const cooldownMs = 48 * 60 * 60 * 1000; // 48h in milliseconds
    const timeSinceLastRankUp = now - lastRankUp;
    const isOnCooldown = lastRankUp > 0 && timeSinceLastRankUp < cooldownMs;
    
    // Convertir les minutes de vocal en heures
    const voiceHours = (user.totalVoiceMinutes || 0) / 60;
    const messages = user.totalMessages || 0;
    
    // Déterminer si l'utilisateur remplit les conditions
    // Selon que c'est un OU ou un ET entre les conditions messages et vocal
    let meetsRequirements;
    if (nextRank.isOrCondition) {
        // Condition OU : messages OU vocal
        meetsRequirements = messages >= nextRank.requiredMessages || 
                          voiceHours >= nextRank.requiredVoiceHours;
    } else {
        // Condition ET : messages ET vocal (même si requiredMessages est à 0, on ne le vérifie pas)
        const meetsMessages = nextRank.requiredMessages === 0 || messages >= nextRank.requiredMessages;
        const meetsVoice = voiceHours >= nextRank.requiredVoiceHours;
        meetsRequirements = meetsMessages && meetsVoice;
    }
    
    // Check requirements
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
            
            // Différer la réponse immédiatement
            if (!interaction.replied && !interaction.deferred) {
                console.log('Début du différé de la réponse...');
                await interaction.deferReply({ ephemeral: true });
                console.log('Réponse différée avec succès');
            }
            
            // Vérifier si l'utilisateur est blacklisté
            if (await client.db.isBlacklisted(interaction.user.id)) {
                return interaction.editReply({
                    content: '⛔ Vous êtes sur la liste noire et ne pouvez pas utiliser le système de rang.',
                    ephemeral: true
                });
            }
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            console.log(`User ID: ${userId}, Guild ID: ${guildId}`);
            
            // Vérifier si l'utilisateur a le rôle requis ou un rôle de permission
            const member = await interaction.guild.members.fetch(userId);
            const hasRequiredRole = member.roles.cache.has(client.config.requiredRoleId);
            
            // Vérifier si l'utilisateur a un des rôles de permission
            const hasAnyPermRole = client.config.permissions.some(perm => 
                member.roles.cache.has(perm.roleId)
            );
            
            // Si l'utilisateur n'a ni le rôle requis ni un rôle de permission
            if (!hasRequiredRole && !hasAnyPermRole) {
                return interaction.editReply({
                    content: `❌ Vous devez avoir le rôle <@&${client.config.requiredRoleId}> ou un rôle de permission pour utiliser cette commande.`
                });
            }
            
            // Get user stats from database
            console.log('Récupération des stats utilisateur...');
            const user = await client.db.getUserStats(interaction.user.id);
            console.log('Stats utilisateur récupérées:', user);
            if (!user) {
                return interaction.editReply({
                    content: "You're not registered in the system yet! Send a message first.",
                    ephemeral: true
                });
            }
            
            // Find the highest rank the user has
            let currentRankIndex = -1;
            
            // Check which is the highest rank role the user has
            for (let i = 0; i < client.config.ranks.length; i++) {
                const rank = client.config.ranks[i];
                if (member.roles.cache.has(rank.roleId)) {
                    currentRankIndex = i;
                }
            }
            
            if (currentRankIndex === -1) {
                // User has no rank roles, assign the first rank
                currentRankIndex = 0;
                try {
                    await member.roles.add(client.config.ranks[0].roleId, 'Initial rank assignment');
                } catch (error) {
                    console.error('Error assigning initial rank:', error);
                }
            }
            
            const currentRank = client.config.ranks[currentRankIndex];
            const nextRank = client.config.ranks[currentRankIndex + 1];
            
            // Récupérer les noms des rôles depuis Discord
            const currentRankRole = interaction.guild.roles.cache.get(currentRank.roleId);
            const nextRankRole = interaction.guild.roles.cache.get(nextRank?.roleId);
            
            // Check if user is already at max rank
            if (!nextRank) {
                const currentRankName = currentRankRole?.name || currentRank.name;
                return interaction.editReply({
                    content: `🎉 Félicitations ! Vous avez atteint le rang maximum: **${currentRankName}**`,
                    ephemeral: true
                });
            }
            
            // Vérifier les conditions de rank-up
            const requirements = checkRankUpRequirements(user, nextRank, client.config);
            
            // Utiliser les noms des rôles de Discord ou ceux de la config en fallback
            const nextRankName = nextRankRole?.name || nextRank.name;
            
            // Créer l'embed de réponse
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
            
            // Créer le bouton de rank-up
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('rankup_button')
                    .setLabel('Rank Up!')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⬆️')
                    .setDisabled(!requirements.meetsRequirements || requirements.isOnCooldown)
            );
            
            // Envoyer la réponse
            await interaction.editReply({
                embeds: [embed],
                components: [row],
                ephemeral: true
            });
        } catch (error) {
            console.error('Erreur dans la commande /rankup:', error);
            
            // Vérifier si l'interaction est déjà répondue/différée
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
        // Acknowledge the button click
        await interaction.deferUpdate();
        
        // Double-check requirements in case something changed
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
        
        // No need to update rank in database anymore, just update roles
        
        // Get the member to assign roles
        const member = interaction.guild.members.cache.get(interaction.user.id) || 
                      await interaction.guild.members.fetch(interaction.user.id);
        
        // Get all rank role IDs from config
        const rankRoleIds = client.config.ranks.map(rank => rank.roleId);
        
        // Assign the new role if specified and the bot has permission
        if (nextRank.roleId) {
            try {
                // Add the new role first
                await member.roles.add(nextRank.roleId, 'Rank up');
                
                // Remove all other rank roles
                const rolesToRemove = rankRoleIds.filter(id => id !== nextRank.roleId);
                if (rolesToRemove.length > 0) {
                    await member.roles.remove(rolesToRemove, 'Rank up - removing previous ranks');
                }
                
                // Also remove any permission roles that might be associated with old ranks
                const currentPermissionId = nextRank.permissionId;
                const permissionRolesToRemove = client.config.permissions
                    .filter(p => p.id !== currentPermissionId)
                    .map(p => p.roleId);
                    
                if (permissionRolesToRemove.length > 0) {
                    await member.roles.remove(permissionRolesToRemove, 'Rank up - updating permissions');
                }
                
            } catch (roleError) {
                logger.error('Error updating roles:', roleError);
                // Continue even if role assignment fails
            }
        }
        
        // Create success embed
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
        
        // Send success message
        await interaction.followUp({
            content: `${interaction.user.toString()} has ranked up to **${nextRank.name}**!`,
            embeds: [successEmbed]
        });
        
        // Log the rank up
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
