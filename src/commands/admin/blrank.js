const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { dbManager } = require('../../../database');
const logger = require('../../utils/logger');
module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Manage rank blacklist')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Add or remove from blacklist')
                .setRequired(true)
                .addChoices(
                    { name: 'Add', value: 'add' },
                    { name: 'Remove', value: 'remove' }
                ))
        .addUserOption(option =>
            option.setName('member')
                .setDescription('The member to add/remove from blacklist')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason (required when adding)')
                .setRequired(false)),
    async execute(interaction) {
        const action = interaction.options.getString('action');
        const memberOption = interaction.options.getMember('member');
        if (!memberOption) {
            return interaction.editReply({ 
                content: '❌ Membre introuvable.'
            });
        }
        const targetUser = memberOption.user;
        const reason = interaction.options.getString('reason') || 'Aucune raison fournie';
        try {
            if (action === 'add') {
                await this.handleAdd(interaction, targetUser, reason);
            } else if (action === 'remove') {
                await this.handleRemove(interaction, targetUser);
            }
        } catch (error) {
            logger.error('Error in blacklist command:', error);
            await interaction.editReply({ 
                content: '❌ Une erreur est survenue lors du traitement de votre demande.',
                ephemeral: true 
            });
        }
    },
    async handleAdd(interaction, targetUser, reason) {
        try {
            const existing = await dbManager.getBlacklistedUser(targetUser.id);
            if (existing) {
                return interaction.editReply({
                    content: `❌ <@${targetUser.id}> est déjà dans la blacklist.`
                });
            }
            let user = await dbManager.getUser(targetUser.id);
            if (!user) {
                await dbManager.createUser(
                    targetUser.id, 
                    Math.floor(Date.now() / 1000) 
                );
                user = await dbManager.getUser(targetUser.id);
                if (!user) {
                    throw new Error('Failed to create user record');
                }
            }
            await dbManager.addToBlacklist(
                targetUser.id,
                interaction.user.id,
                reason
            );
            const modLogChannel = interaction.guild.channels.cache.find(
                channel => channel.name === 'mod-log' || channel.name === 'logs'
            );
            if (modLogChannel) {
                try {
                    const embed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('🔴 Membre Blacklisté')
                        .setDescription(`${targetUser.tag} (${targetUser.id}) a été blacklisté du système de classement.`)
                        .addFields(
                            { name: 'Raison', value: reason },
                            { name: 'Modérateur', value: `${interaction.user.tag} (${interaction.user.id})` }
                        )
                        .setTimestamp();
                    await modLogChannel.send({ embeds: [embed] });
                } catch (logError) {
                    logger.error('Failed to send mod-log:', logError);
                }
            }
            await interaction.editReply({ 
                content: `✅ ${targetUser.tag} a été ajouté(e) à la blacklist du classement.`
            });
        } catch (error) {
            logger.error('Error in handleAdd:', error);
            await interaction.reply({
                content: 'Une erreur est survenue lors du traitement de votre demande.',
                ephemeral: true
            });
        }
    },
    async handleRemove(interaction, targetUser) {
        try {
            const isBlacklisted = await dbManager.isBlacklisted(targetUser.id);
            if (!isBlacklisted) {
                return interaction.editReply({ 
                    content: `❌ ${targetUser.tag} n'est pas actuellement dans la blacklist.`
                });
            }
            const result = await dbManager.removeFromBlacklist(targetUser.id);
            if (result.changes === 0) {
                throw new Error('No changes made to blacklist');
            }
            const modLogChannel = interaction.guild.channels.cache.find(
                channel => channel.name === 'mod-log' || channel.name === 'logs'
            );
            if (modLogChannel) {
                try {
                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('🟢 Membre Retiré de la Blacklist')
                        .setDescription(`${targetUser.tag} (${targetUser.id}) a été retiré de la blacklist du classement.`)
                        .addFields(
                            { name: 'Modérateur', value: `${interaction.user.tag} (${interaction.user.id})` }
                        )
                        .setTimestamp();
                    await modLogChannel.send({ embeds: [embed] });
                } catch (logError) {
                    logger.error('Failed to send mod-log:', logError);
                }
            }
            await interaction.editReply({ 
                content: `✅ ${targetUser.tag} a été retiré(e) de la blacklist du classement.`
            });
        } catch (error) {
            logger.error('Error in handleRemove:', error);
            await interaction.reply({
                content: 'Une erreur est survenue lors du traitement de votre demande.',
                ephemeral: true
            });
        }
    },
    async handleList(interaction) {
        try {
            const blacklist = await dbManager.getBlacklist();
            if (!blacklist || blacklist.length === 0) {
                return interaction.reply({
                    content: 'No users are currently blacklisted from ranking up.',
                    ephemeral: true
                });
            }
            const embed = new EmbedBuilder()
                .setTitle('Rank Blacklist')
                .setColor(0x3498DB)
                .setDescription('Users who are blacklisted from ranking up:');
            const fields = blacklist.map(entry => ({
                name: `User ID: ${entry.userId}`,
                value: `**Reason:** ${entry.reason || 'No reason provided'}\n` +
                       `**Blacklisted by:** <@${entry.adminId}>\n` +
                       `**Date:** <t:${Math.floor(entry.createdAt / 1000)}:f>`,
                inline: false
            }));
            const chunks = [];
            for (let i = 0; i < fields.length; i += 25) {
                chunks.push(fields.slice(i, i + 25));
            }
            await interaction.reply({ 
                embeds: [
                    new EmbedBuilder(embed.toJSON())
                        .addFields(chunks[0])
                ],
                ephemeral: true 
            });
            for (let i = 1; i < chunks.length; i++) {
                await interaction.followUp({ 
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Rank Blacklist (continued)')
                            .setColor(0x3498DB)
                            .addFields(chunks[i])
                    ],
                    ephemeral: true 
                });
            }
        } catch (error) {
            logger.error('Error in handleList:', error);
            await interaction.reply({ 
                content: 'An error occurred while fetching the blacklist.',
                ephemeral: true 
            });
        }
    }
};