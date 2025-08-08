const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionResponseFlags } = require('discord.js');
const { checkRankUpRequirements } = require('../commands/rankup/rankup');

// Options par défaut pour les réponses
const defaultOptions = {
    fetchReply: true,
    ephemeral: true
};

module.exports = {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction, client) {
        // Fonction utilitaire pour gérer les réponses de manière sécurisée
        const safeReply = async (options) => {
            try {
                const replyOptions = {
                    ...options,
                    ...defaultOptions
                };
                
                if (interaction.replied || interaction.deferred) {
                    return await interaction.followUp(replyOptions);
                } else {
                    return await interaction.reply(replyOptions);
                }
            } catch (error) {
                if (error.code !== 10062) { // Ignorer les erreurs d'interaction inconnue
                    console.error('Erreur lors de l\'envoi de la réponse:', error);
                }
                return null;
            }
        };

        try {
            // Vérifier si l'interaction a déjà été traitée
            if (interaction.replied || interaction.deferred) {
                console.log('Interaction déjà traitée, ignore...');
                return;
            }

            // Handle slash commands
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                
                if (!command) {
                    console.error(`Aucune commande correspondant à ${interaction.commandName} n'a été trouvée.`);
                    return await safeReply({
                        content: '❌ Commande non reconnue.'
                    });
                }
                
                try {
                    // Ne pas différer la réponse ici, laisser chaque commande gérer son propre différé
                    // si nécessaire
                    await command.execute(interaction, client);
                } catch (error) {
                    console.error('Erreur lors de l\'exécution de la commande:', error);
                    
                    // Vérifier à nouveau l'état avant d'envoyer un message d'erreur
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: '❌ Une erreur est survenue lors de l\'exécution de cette commande !',
                            ephemeral: true
                        }).catch(console.error);
                    } else if (interaction.replied) {
                        await interaction.followUp({
                            content: '❌ Une erreur est survenue lors de l\'exécution de cette commande !',
                            ephemeral: true
                        }).catch(console.error);
                    }
                }
            }
            // Handle button interactions
            else if (interaction.isButton()) {
                console.log(`Bouton cliqué: ${interaction.customId}`);
                if (interaction.customId === 'rankup_button') {
                    console.log('Traitement du bouton rankup...');
                    try {
                        await handleRankUpButton(interaction, client);
                    } catch (error) {
                        console.error('Erreur dans le gestionnaire de bouton rankup:', error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({
                                content: '❌ Une erreur est survenue lors du traitement de votre action.',
                                ephemeral: true
                            }).catch(console.error);
                        }
                    }
                }
            }
            // Handle other interaction types
            else {
                console.log('Type d\'interaction non géré:', interaction.type);
            }
        } catch (error) {
            console.error('Erreur non gérée dans interactionCreate:', error);
            try {
                await safeReply({
                    content: '❌ Une erreur est survenue lors du traitement de cette interaction.',
                    ephemeral: true
                });
            } catch (e) {
                console.error('Impossible d\'envoyer le message d\'erreur:', e);
            }
        }
    },
};

async function handleRankUpButton(interaction, client) {
    console.log('handleRankUpButton called');
    
    // Fonction utilitaire pour gérer les réponses de manière sécurisée
    const safeReply = async (options) => {
        console.log('safeReply called with options:', options);
        console.log(`Interaction state - replied: ${interaction.replied}, deferred: ${interaction.deferred}`);
        
        // Ne rien faire si l'interaction a déjà reçu une réponse
        if (interaction.replied || interaction.deferred) {
            console.log('Interaction already has a response, using followUp');
            // Si on a déjà répondu, utiliser followUp
            if (interaction.replied) {
                try {
                    const result = await interaction.followUp({
                        ...options,
                        ephemeral: true
                    });
                    console.log('followUp successful');
                    return result;
                } catch (e) {
                    console.error('Error in followUp:', e);
                    return null;
                }
            }
            // Si c'est différé mais pas encore répondu, on ne fait rien
            console.log('Interaction deferred but not replied yet, doing nothing');
            return null;
        }

        // Sinon, répondre normalement
        console.log('Sending new reply');
        try {
            const result = await interaction.reply({
                ...options,
                ephemeral: true,
                fetchReply: true
            });
            console.log('Reply sent successfully');
            return result;
        } catch (e) {
            if (e.code !== 10062) { // Ignorer les erreurs d'interaction inconnue
                console.error('Erreur lors de l\'envoi de la réponse:', e);
            } else {
                console.log('Interaction already acknowledged (code 10062)');
            }
            return null;
        }
    };

    try {
        console.log('Vérification de l\'état de l\'interaction...');
        // Vérifier si l'interaction a déjà été traitée
        if (interaction.replied || interaction.deferred) {
            console.log('Interaction déjà traitée - replied:', interaction.replied, 'deferred:', interaction.deferred);
            return;
        }
        
        // Différer la réponse immédiatement
        console.log('Début du différé de la réponse...');
        try {
            await interaction.deferUpdate();
            console.log('Réponse différée avec succès');
        } catch (deferError) {
            console.error('Erreur lors du différé de la réponse:', deferError);
            // Essayer de répondre normalement en cas d'échec du différé
            if (!interaction.replied) {
                await interaction.reply({
                    content: '❌ Une erreur est survenue lors du traitement de votre demande.',
                    ephemeral: true
                }).catch(e => console.error('Échec de la réponse d\'erreur:', e));
            }
            return;
        }
        
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        
        // Récupérer les données utilisateur depuis la base de données
        const user = await client.db.getUser(userId);
        if (!user) {
            if (!interaction.replied) {
                return await safeReply({ 
                    content: "❌ Vous n'êtes pas enregistré dans le système.",
                    flags: [InteractionResponseFlags.Ephemeral]
                });
            }
            return;
        }
        
        // Check if user is the owner (bypasses all role requirements)
        const isOwner = userId === client.config.ownerId;
        
        // Get the member object first
        const member = await interaction.guild.members.fetch(userId);
        
        // Only check role requirements if user is not the owner
        if (!isOwner) {
            // Vérifier si l'utilisateur a au moins un des rôles de permission
            const hasAnyPermissionRole = client.config.ranks.some(rank => 
                rank.permissionId && member.roles.cache.has(rank.roleId)
            );
            
            if (!hasAnyPermissionRole) {
                return await safeReply({
                    content: `❌ Vous devez avoir un rôle de permission pour utiliser cette commande.`,
                    ephemeral: true
                });
            }
        }
        
        // Find the user's current rank based on their roles
        let currentRankIndex = -1;
        
        // Find the highest rank role the user has
        for (let i = 0; i < client.config.ranks.length; i++) {
            const rank = client.config.ranks[i];
            if (member.roles.cache.has(rank.roleId)) {
                currentRankIndex = i;
            }
        }
        
        // If user has no rank role, assign the first rank
        if (currentRankIndex === -1) {
            currentRankIndex = 0;
            try {
                await member.roles.add(client.config.ranks[0].roleId, 'Initial rank assignment');
            } catch (error) {
                console.error('Error assigning initial rank:', error);
            }
        }
        
        // Check if user is already at max rank
        if (currentRankIndex >= client.config.ranks.length - 1) {
            const currentRank = client.config.ranks[currentRankIndex];
            const currentRankRole = interaction.guild.roles.cache.get(currentRank.roleId)?.name || currentRank.name;
            return await safeReply({ 
                content: `🎉 Félicitations ! Vous avez atteint le rang maximum: **${currentRankRole}**`,
                ephemeral: true
            });
        }
        
        const currentRank = client.config.ranks[currentRankIndex];
        const nextRank = client.config.ranks[currentRankIndex + 1];
        
        // Vérifier les conditions de rank-up
        const requirements = checkRankUpRequirements(user, nextRank, client.config);
        
        // Vérifier si l'utilisateur est en cooldown
        if (requirements.isOnCooldown) {
            return await safeReply({
                content: `⏳ Vous devez attendre encore ${formatTime(requirements.cooldownRemaining)} avant de pouvoir rank up à nouveau.`,
                ephemeral: true
            });
        }
        
        // Vérifier si l'utilisateur remplit les conditions
        if (!requirements.meetsRequirements) {
            return await safeReply({
                content: "❌ Vous ne remplissez pas encore les conditions nécessaires pour monter de rang.",
                ephemeral: true
            });
        }
        
        // No need to update rank in database, just update roles
        
        // Update Discord roles
        try {
            // Get current member roles
            const currentRoles = new Set(member.roles.cache.keys());
            const rolesToAdd = [];
            const rolesToRemove = [];
            
            // 1. Add new rank role
            if (nextRank.roleId) {
                rolesToAdd.push(nextRank.roleId);
                
                // Update the lastRankUp timestamp in the database
                try {
                    await client.db.updateUserRank(userId, interaction.guildId, nextRank.id);
                } catch (error) {
                    console.error('Error updating lastRankUp:', error);
                }
            }
            
            // 2. Add new permission role if applicable
            const newPermission = client.config.permissions.find(p => p.id === nextRank.permissionId);
            if (newPermission?.roleId) {
                rolesToAdd.push(newPermission.roleId);
            }
            
            // 3. Remove old rank and permission roles
            // First, remove all existing rank roles
            for (const rank of client.config.ranks) {
                if (rank.roleId && currentRoles.has(rank.roleId)) {
                    rolesToRemove.push(rank.roleId);
                }
            }
            
            // Remove old permission roles
            for (const perm of client.config.permissions) {
                if (perm.roleId && currentRoles.has(perm.roleId) && 
                    (!newPermission || perm.id !== newPermission.id)) {
                    rolesToRemove.push(perm.roleId);
                }
            }
            
            // Filter out any roles we're adding from the remove list (in case of duplicates)
            const finalRemoveRoles = rolesToRemove.filter(roleId => !rolesToAdd.includes(roleId));
            
            // Apply role changes
            if (finalRemoveRoles.length > 0) {
                await member.roles.remove(finalRemoveRoles)
                    .catch(err => console.error("Error removing roles:", err));
            }
            
            if (rolesToAdd.length > 0) {
                // Only add roles that the member doesn't already have
                const rolesToActuallyAdd = rolesToAdd.filter(roleId => !currentRoles.has(roleId));
                if (rolesToActuallyAdd.length > 0) {
                    await member.roles.add(rolesToActuallyAdd)
                        .catch(err => console.error("Error adding roles:", err));
                }
            }
        } catch (error) {
            console.error("Erreur lors de la mise à jour des rôles:", error);
        }
        
        // Get role names from the server
        const currentRankRole = currentRank?.roleId ? 
            interaction.guild.roles.cache.get(currentRank.roleId)?.name || currentRank.name : 
            currentRank?.name || 'Aucun';
            
        const nextRankRole = nextRank.roleId ? 
            interaction.guild.roles.cache.get(nextRank.roleId)?.name || nextRank.name : 
            nextRank.name;
        
        // Create confirmation embed
        const embed = new EmbedBuilder()
            .setColor('#57F287')
            .setTitle('🎉 Félicitations !')
            .setDescription(`Vous avez atteint le rang **${nextRankRole}** avec succès !`)
            .addFields(
                { name: 'Ancien rang', value: currentRankRole, inline: true },
                { name: 'Nouveau rang', value: nextRankRole, inline: true },
                { name: 'Date du rank-up', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
            )
            .setTimestamp();
        
        // Mettre à jour le message avec la confirmation
        try {
            await interaction.editReply({
                embeds: [embed],
                components: [] // Supprimer les boutons
            });
        } catch (e) {
            console.error('Erreur lors de la mise à jour du message:', e);
            await safeReply({
                content: `🎉 Félicitations ! Vous avez atteint le rang **${nextRankRole}** avec succès !`,
                ephemeral: true
            });
        }
        
    } catch (error) {
        console.error('Erreur lors du traitement du rank-up:', error);
        await safeReply({
            content: '❌ Une erreur est survenue lors de la mise à jour de votre rang. Veuillez réessayer plus tard.',
            ephemeral: true
        });
    }
}

// Fonction utilitaire pour formater le temps
function formatTime(ms) {
    if (!ms || isNaN(ms)) return '0s';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    const parts = [];
    if (days > 0) parts.push(`${days}j`);
    if (hours % 24 > 0) parts.push(`${hours % 24}h`);
    if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
    if (seconds % 60 > 0 || parts.length === 0) parts.push(`${seconds % 60}s`);
    
    return parts.join(' ');
}
