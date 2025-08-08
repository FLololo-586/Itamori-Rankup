const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionResponseFlags } = require('discord.js');
const { checkRankUpRequirements } = require('../commands/rankup/rankup');
const defaultOptions = {
    fetchReply: true,
    ephemeral: true
};
module.exports = {
    name: Events.InteractionCreate,
    once: false,
    async execute(interaction, client) {
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
                if (error.code !== 10062) { 
                    console.error('Erreur lors de l\'envoi de la réponse:', error);
                }
                return null;
            }
        };
        try {
            if (interaction.replied || interaction.deferred) {
                console.log('Interaction déjà traitée, ignore...');
                return;
            }
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) {
                    console.error(`Aucune commande correspondant à ${interaction.commandName} n'a été trouvée.`);
                    return await safeReply({
                        content: '❌ Commande non reconnue.'
                    });
                }
                try {
                    await command.execute(interaction, client);
                } catch (error) {
                    console.error('Erreur lors de l\'exécution de la commande:', error);
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
    const safeReply = async (options) => {
        console.log('safeReply called with options:', options);
        console.log(`Interaction state - replied: ${interaction.replied}, deferred: ${interaction.deferred}`);
        if (interaction.replied || interaction.deferred) {
            console.log('Interaction already has a response, using followUp');
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
            console.log('Interaction deferred but not replied yet, doing nothing');
            return null;
        }
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
            if (e.code !== 10062) { 
                console.error('Erreur lors de l\'envoi de la réponse:', e);
            } else {
                console.log('Interaction already acknowledged (code 10062)');
            }
            return null;
        }
    };
    try {
        console.log('Vérification de l\'état de l\'interaction...');
        if (interaction.replied || interaction.deferred) {
            console.log('Interaction déjà traitée - replied:', interaction.replied, 'deferred:', interaction.deferred);
            return;
        }
        console.log('Début du différé de la réponse...');
        try {
            await interaction.deferUpdate();
            console.log('Réponse différée avec succès');
        } catch (deferError) {
            console.error('Erreur lors du différé de la réponse:', deferError);
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
        const isOwner = userId === client.config.ownerId;
        const member = await interaction.guild.members.fetch(userId);
        if (!isOwner) {
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
        const requirements = checkRankUpRequirements(user, nextRank, client.config);
        if (requirements.isOnCooldown) {
            return await safeReply({
                content: `⏳ Vous devez attendre encore ${formatTime(requirements.cooldownRemaining)} avant de pouvoir rank up à nouveau.`,
                ephemeral: true
            });
        }
        if (!requirements.meetsRequirements) {
            return await safeReply({
                content: "❌ Vous ne remplissez pas encore les conditions nécessaires pour monter de rang.",
                ephemeral: true
            });
        }
        try {
            const currentRoles = new Set(member.roles.cache.keys());
            const rolesToAdd = [];
            const rolesToRemove = [];
            if (nextRank.roleId) {
                rolesToAdd.push(nextRank.roleId);
                try {
                    await client.db.updateUserRank(userId, interaction.guildId, nextRank.id);
                } catch (error) {
                    console.error('Error updating lastRankUp:', error);
                }
            }
            const newPermission = client.config.permissions.find(p => p.id === nextRank.permissionId);
            if (newPermission?.roleId) {
                rolesToAdd.push(newPermission.roleId);
            }
            for (const rank of client.config.ranks) {
                if (rank.roleId && currentRoles.has(rank.roleId)) {
                    rolesToRemove.push(rank.roleId);
                }
            }
            for (const perm of client.config.permissions) {
                if (perm.roleId && currentRoles.has(perm.roleId) && 
                    (!newPermission || perm.id !== newPermission.id)) {
                    rolesToRemove.push(perm.roleId);
                }
            }
            const finalRemoveRoles = rolesToRemove.filter(roleId => !rolesToAdd.includes(roleId));
            if (finalRemoveRoles.length > 0) {
                await member.roles.remove(finalRemoveRoles)
                    .catch(err => console.error("Error removing roles:", err));
            }
            if (rolesToAdd.length > 0) {
                const rolesToActuallyAdd = rolesToAdd.filter(roleId => !currentRoles.has(roleId));
                if (rolesToActuallyAdd.length > 0) {
                    await member.roles.add(rolesToActuallyAdd)
                        .catch(err => console.error("Error adding roles:", err));
                }
            }
        } catch (error) {
            console.error("Erreur lors de la mise à jour des rôles:", error);
        }
        const currentRankRole = currentRank?.roleId ? 
            interaction.guild.roles.cache.get(currentRank.roleId)?.name || currentRank.name : 
            currentRank?.name || 'Aucun';
        const nextRankRole = nextRank.roleId ? 
            interaction.guild.roles.cache.get(nextRank.roleId)?.name || nextRank.name : 
            nextRank.name;
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
        try {
            await interaction.editReply({
                embeds: [embed],
                components: [] 
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