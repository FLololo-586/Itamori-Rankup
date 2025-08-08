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
        .setName('stat-add')
        .setDescription("Ajouter des statistiques à un membre (Admin uniquement)")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('membre')
                .setDescription('Le membre à qui ajouter des statistiques')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type de statistique à ajouter')
                .setRequired(true)
                .addChoices(
                    { name: 'Messages', value: 'messages' },
                    { name: 'Temps vocal (en minutes)', value: 'voicetime' }
                ))
        .addIntegerOption(option =>
            option.setName('quantite')
                .setDescription('Quantité à ajouter')
                .setRequired(true)
                .setMinValue(1)),

    /**
     * Execute the stat-add command
     * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
     * @param {import('../../index')} client - The Discord client
     */
    async execute(interaction, client) {
        // Différer la réponse immédiatement
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const targetUser = interaction.options.getUser('membre');
            const statType = interaction.options.getString('type');
            const amount = interaction.options.getInteger('quantite');
            
            // Vérifier que la quantité est valide
            if (amount < 1) {
                return await interaction.editReply("La quantité doit être supérieure à 0.");
            }
            
            // Get or create user in the database
            let user = await client.db.getUserStats(targetUser.id);
            if (!user) {
                const member = interaction.guild.members.cache.get(targetUser.id) || 
                              await interaction.guild.members.fetch(targetUser.id).catch(() => null);
                
                if (!member) {
                    return await interaction.editReply("Impossible de trouver ce membre dans le serveur.");
                }
                
                user = await client.db.createUser(targetUser.id, member.joinedTimestamp || Date.now());
            }
            
            // Update the appropriate stat
            let newValue;
            
            if (statType === 'messages') {
                // Ajouter les messages en une seule opération
                await client.db.addMessages(targetUser.id, amount);
                newValue = (user.totalMessages || 0) + amount;
            } else if (statType === 'voicetime') {
                // Add the specified voice time in minutes
                await client.db.addVoiceTime(targetUser.id, amount);
                newValue = (user.totalVoiceMinutes || 0) + amount;
            }
            
            // Format the response
            const formattedValue = statType === 'voicetime' 
                ? formatTime(newValue)
                : newValue.toLocaleString();
                
            const statName = statType === 'messages' ? 'messages' : 'minutes de vocal';
            const statNameCapitalized = statName.charAt(0).toUpperCase() + statName.slice(1);
            
            // Send confirmation
            await interaction.editReply({
                content: `✅ **Statistiques mises à jour pour ${targetUser}**\n` +
                         `**${statNameCapitalized} ajoutés :** ${amount.toLocaleString()}\n` +
                         `**Nouveau total :** ${formattedValue}`,
                ephemeral: true
            });
            
            // Log the action
            logger.info(`[stat-add] ${interaction.user.tag} a ajouté ${amount} ${statName} à ${targetUser.tag}`);
            
        } catch (error) {
            logger.error('Error in stat-add command:', error);
            await interaction.editReply({
                content: 'Une erreur est survenue lors de la mise à jour des statistiques.',
                ephemeral: true
            });
        }
    },
    
    // Add toLowerCase method to String prototype if it doesn't exist
    setup() {
        if (!String.prototype.capitalize) {
            String.prototype.capitalize = function() {
                return this.charAt(0).toUpperCase() + this.slice(1);
            };
        }
    }
};
