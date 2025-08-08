const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { dbManager } = require('../../../database');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('force-reset')
        .setDescription('🔧 [ADMIN] Réinitialise le nombre de messages et le temps vocal de tous les utilisateurs à 0')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('confirmation')
                .setDescription('Tapez "confirmer" pour procéder à la réinitialisation')
                .setRequired(true)),

    async execute(interaction) {
        const confirmation = interaction.options.getString('confirmation');
        
        if (confirmation.toLowerCase() !== 'confirmer') {
            return interaction.reply({
                content: '❌ Réinitialisation annulée. Vous devez taper "confirmer" pour procéder à la réinitialisation.',
                ephemeral: true
            });
        }

        try {
            // Différer la réponse car l'opération peut prendre du temps
            await interaction.deferReply({ ephemeral: true });

            // Réinitialiser les statistiques de tous les utilisateurs
            const resetCount = await dbManager.resetAllUserStats();
            
            await interaction.editReply({
                content: `✅ Réinitialisation réussie pour ${resetCount} utilisateurs. Les compteurs de messages et de temps vocal ont été remis à zéro.`
            });

            logger.info(`L'administrateur ${interaction.user.tag} (${interaction.user.id}) a réinitialisé les statistiques de tous les utilisateurs.`);

        } catch (error) {
            logger.error('Erreur dans la commande force-reset :', error);
            
            const errorMessage = interaction.replied || interaction.deferred
                ? await interaction.editReply({ 
                    content: '❌ Une erreur est survenue lors de la réinitialisation des statistiques.',
                    ephemeral: true 
                })
                : await interaction.reply({ 
                    content: '❌ Une erreur est survenue lors de la réinitialisation des statistiques.',
                    ephemeral: true 
                });
            
            // Supprimer le message d'erreur après 10 secondes
            setTimeout(() => {
                errorMessage.delete().catch(err => logger.error('Erreur lors de la suppression du message d\'erreur :', err));
            }, 10000);
        }
    }
};
