const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../../utils/logger');
const config = require('../../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('derank-all')
        .setDescription("Retire tous les rôles de classement d'un membre")
        .addUserOption(option =>
            option.setName('membre')
                .setDescription('Le membre à derank complètement')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        try {
            const targetMember = interaction.options.getMember('membre');
            
            if (!targetMember) {
                return interaction.editReply({
                    content: '❌ Membre introuvable.'
                });
            }

            // Récupérer tous les rôles de classement et de permission
            const rankRoles = config.ranks.map(rank => rank.roleId).filter(Boolean);
            const permissionRoles = config.permissions.map(perm => perm.roleId).filter(Boolean);
            
            // Filtrer les rôles que le membre a effectivement
            const rolesToRemove = targetMember.roles.cache.filter(role => 
                rankRoles.includes(role.id) || permissionRoles.includes(role.id)
            );

            if (rolesToRemove.size === 0) {
                return interaction.editReply({
                    content: `❌ ${targetMember.user.tag} n'a aucun rôle de classement à supprimer.`
                });
            }

            try {
                // Supprimer tous les rôles en une seule opération
                await targetMember.roles.remove(rolesToRemove, 'Déclassement complet');
                
                logger.info(`Tous les rôles de classement ont été retirés de ${targetMember.user.tag}: ${rolesToRemove.map(r => r.name).join(', ')}`);
                
                return interaction.editReply({
                    content: `✅ Tous les rôles de classement ont été retirés de ${targetMember.user.tag}.`
                });
                
            } catch (error) {
                logger.error('Erreur lors de la suppression des rôles:', error);
                return interaction.editReply({
                    content: '❌ Une erreur est survenue lors de la suppression des rôles.'
                });
            }

        } catch (error) {
            logger.error('Erreur dans la commande derank-all:', error);
            return interaction.editReply({
                content: '❌ Une erreur est survenue lors du déclassement complet.'
            });
        }
    }
};
