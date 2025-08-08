const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../../utils/logger');
const config = require('../../../config.json');
module.exports = {
    data: new SlashCommandBuilder()
        .setName('derank')
        .setDescription('Retire le rang actuel d\'un membre (descend d\'un rang)')
        .addUserOption(option =>
            option.setName('membre')
                .setDescription('Le membre à derank')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ ephemeral: true });
        }
        try {
            const targetMember = interaction.options.getMember('membre');
            if (!targetMember) {
                return interaction.editReply({
                    content: '❌ Membre introuvable.'
                });
            }
            const rankRoles = config.ranks.map(rank => rank.roleId).filter(Boolean);
            const permissionRoles = config.permissions.map(perm => perm.roleId).filter(Boolean);
            const currentRankRole = targetMember.roles.cache.find(role => 
                rankRoles.includes(role.id)
            );
            if (!currentRankRole) {
                return interaction.editReply({
                    content: `❌ ${targetMember.user.tag} n'a aucun rôle de classement actif.`
                });
            }
            const currentRankIndex = config.ranks.findIndex(rank => 
                rank.roleId === currentRankRole.id
            );
            if (currentRankIndex === -1) {
                return interaction.editReply({
                    content: '❌ Impossible de déterminer le rang actuel du membre.'
                });
            }
            if (currentRankIndex === 0) {
                return interaction.editReply({
                    content: `❌ ${targetMember.user.tag} est déjà au rang le plus bas.`
                });
            }
            const targetRank = config.ranks[currentRankIndex - 1];
            const targetRankRole = interaction.guild.roles.cache.get(targetRank.roleId);
            if (!targetRankRole) {
                return interaction.editReply({
                    content: '❌ Impossible de trouver le rôle du rang cible.'
                });
            }
            const currentPermissionId = config.ranks[currentRankIndex]?.permissionId;
            const targetPermissionId = targetRank.permissionId;
            const currentPermission = config.permissions.find(p => p.id === currentPermissionId);
            const targetPermission = config.permissions.find(p => p.id === targetPermissionId);
            const rolesToAdd = [targetRank.roleId]; 
            const rolesToRemove = [currentRankRole.id]; 
            const currentPermissionRole = currentPermission?.roleId;
            const targetPermissionRole = config.permissions.find(p => p.id === targetRank.permissionId)?.roleId;
            if (currentPermissionRole && targetPermissionRole && currentPermissionRole !== targetPermissionRole) {
                rolesToRemove.push(currentPermissionRole);
                rolesToAdd.push(targetPermissionRole);
            }
            if (currentPermission?.roleId && targetPermission?.roleId && 
                currentPermission.roleId !== targetPermission.roleId) {
                rolesToAdd.push(targetPermission.roleId);
                rolesToRemove.push(currentPermission.roleId);
            }
            try {
                if (rolesToRemove.length > 0) {
                    await targetMember.roles.remove(rolesToRemove, 'Déclassement de rang');
                }
                if (rolesToAdd.length > 0) {
                    await targetMember.roles.add(rolesToAdd, 'Déclassement de rang');
                }
                logger.info(`Déclassement de ${targetMember.user.tag} du rang ${currentRankRole.name} à ${targetRankRole.name}`);
                return interaction.editReply({
                    content: `✅ ${targetMember.user.tag} a été déclassé de **${currentRankRole.name}** à **${targetRankRole.name}**.`
                });
            } catch (error) {
                logger.error('Erreur lors de la modification des rôles:', error);
                return interaction.editReply({
                    content: '❌ Une erreur est survenue lors de la modification des rôles.'
                });
            }
        } catch (error) {
            logger.error('Erreur dans la commande derank:', error);
            return interaction.editReply({
                content: '❌ Une erreur est survenue lors du déclassement.'
            });
        }
    }
};