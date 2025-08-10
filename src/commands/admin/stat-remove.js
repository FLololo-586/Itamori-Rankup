const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stat-remove')
        .setDescription("Retirer des statistiques à un membre (Admin uniquement)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('membre')
                .setDescription('Le membre à qui retirer des statistiques')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type de statistique à retirer')
                .setRequired(true)
                .addChoices(
                    { name: 'Messages', value: 'messages' },
                    { name: 'Temps vocal (en minutes)', value: 'voicetime' }
                ))
        .addIntegerOption(option =>
            option.setName('quantite')
                .setDescription('Quantité à retirer')
                .setRequired(true)
                .setMinValue(1)),

    /**
     * Execute the stat-remove command
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @param {import('../../index')} client - The Discord client
     */
    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const targetUser = interaction.options.getUser('membre');
            const statType = interaction.options.getString('type');
            const amount = interaction.options.getInteger('quantite');

            if (amount < 1) {
                return await interaction.editReply("La quantité doit être supérieure à 0.");
            }

            let user = await client.db.getUserStats(targetUser.id);
            if (!user) {
                return await interaction.editReply("Aucune statistique trouvée pour ce membre.");
            }

            let currentValue, newValue;
            
            if (statType === 'messages') {
                currentValue = user.totalMessages || 0;
                if (currentValue < amount) {
                    return await interaction.editReply(`Ce membre n'a que ${currentValue.toLocaleString()} messages. Impossible de retirer ${amount.toLocaleString()}.`);
                }
                await client.db.addMessages(targetUser.id, -amount);
                newValue = currentValue - amount;
            } else if (statType === 'voicetime') {
                currentValue = user.totalVoiceMinutes || 0;
                if (currentValue < amount) {
                    return await interaction.editReply(`Ce membre n'a que ${formatTime(currentValue)} de temps vocal. Impossible de retirer ${amount} minutes.`);
                }
                await client.db.addVoiceTime(targetUser.id, -amount);
                newValue = currentValue - amount;
            }

            const formattedValue = statType === 'voicetime' 
                ? formatTime(newValue)
                : newValue.toLocaleString();
            
            const statName = statType === 'messages' ? 'messages' : 'minutes de vocal';
            const statNameCapitalized = statName.charAt(0).toUpperCase() + statName.slice(1);

            await interaction.editReply({
                content: `✅ **Statistiques mises à jour pour ${targetUser}**\n` +
                         `**${statNameCapitalized} retirés :** ${amount.toLocaleString()}\n` +
                         `**Nouveau total :** ${formattedValue}`,
                ephemeral: true
            });

            logger.info(`[stat-remove] ${interaction.user.tag} a retiré ${amount} ${statName} à ${targetUser.tag}`);

        } catch (error) {
            logger.error('Error in stat-remove command:', error);
            await interaction.editReply({
                content: 'Une erreur est survenue lors de la mise à jour des statistiques.',
                ephemeral: true
            });
        }
    },

    setup() {
        if (!String.prototype.capitalize) {
            String.prototype.capitalize = function() {
                return this.charAt(0).toUpperCase() + this.slice(1);
            };
        }
    }
};
