const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { dbManager } = require('../../../database');
const logger = require('../../utils/logger');
module.exports = {
    data: new SlashCommandBuilder()
        .setName('list-blacklist')
        .setDescription('List all blacklisted users and their reasons')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        try {
            const blacklist = await dbManager.getBlacklist();
            if (blacklist.length === 0) {
                return interaction.reply({
                    content: 'No users are currently blacklisted.',
                    ephemeral: true
                });
            }
            const embed = new EmbedBuilder()
                .setTitle('Blacklisted Users')
                .setColor(0xFF0000)
                .setTimestamp();
            for (const entry of blacklist) {
                try {
                    const user = await interaction.client.users.fetch(entry.userId);
                    const moderator = await interaction.client.users.fetch(entry.adminId).catch(() => ({}));
                    embed.addFields({
                        name: `${user.tag} (${user.id})`,
                        value: `**Reason:** ${entry.reason || 'No reason provided'}\n` +
                               `**Moderator:** ${moderator.tag || 'Unknown'}\n` +
                               `**Date:** <t:${Math.floor(entry.createdAt)}:F>`,
                        inline: false
                    });
                } catch (error) {
                    logger.error(`Error fetching user ${entry.userId}:`, error);
                    embed.addFields({
                        name: `Unknown User (${entry.userId})`,
                        value: `**Reason:** ${entry.reason || 'No reason provided'}\n` +
                               `**Date:** <t:${Math.floor(entry.createdAt)}:F>`,
                        inline: false
                    });
                }
            }
            const maxFieldsPerEmbed = 25;
            if (blacklist.length > maxFieldsPerEmbed) {
                const embeds = [];
                let currentEmbed = new EmbedBuilder()
                    .setTitle('Blacklisted Users (Part 1)')
                    .setColor(0xFF0000);
                let fieldCount = 0;
                let embedCount = 1;
                for (const field of embed.data.fields) {
                    if (fieldCount >= maxFieldsPerEmbed) {
                        embeds.push(currentEmbed);
                        embedCount++;
                        currentEmbed = new EmbedBuilder()
                            .setTitle(`Blacklisted Users (Part ${embedCount})`)
                            .setColor(0xFF0000);
                        fieldCount = 0;
                    }
                    currentEmbed.addFields(field);
                    fieldCount++;
                }
                if (currentEmbed.data.fields?.length > 0) {
                    embeds.push(currentEmbed);
                }
                return interaction.reply({
                    embeds: embeds,
                    ephemeral: true
                });
            }
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        } catch (error) {
            logger.error('Error listing blacklist:', error);
            await interaction.reply({
                content: 'An error occurred while fetching the blacklist.',
                ephemeral: true
            });
        }
    },
};