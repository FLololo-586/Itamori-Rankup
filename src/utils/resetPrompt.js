const readline = require('readline');
const logger = require('./logger');
const { dbManager } = require('../../database');

/**
 * Utilitaire pour demander la date du prochain reset au démarrage du bot
 */
class ResetPrompt {
    constructor() {
        this.rl = null;
    }

    /**
     * Demande la date du prochain reset à l'utilisateur
     * @returns {Promise<Date>} La date du prochain reset
     */
    async promptForResetDate() {
        return new Promise((resolve, reject) => {
            this.rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            console.log('\n🔄 Configuration du système de reset');
            console.log('=====================================');
            console.log('Le bot a besoin de connaître la date du prochain reset.');
            console.log('Format attendu: DD-MM (jour-mois), le reset aura lieu à 00:00 de ce jour.');
            console.log('Exemple: 15-08 pour le 15 août à 00:00\n');

            this.rl.question('📅 Entrez la date du prochain reset (DD-MM): ', (input) => {
                try {
                    const resetDate = this.parseResetDate(input.trim());
                    this.rl.close();
                    resolve(resetDate);
                } catch (error) {
                    console.log(`❌ Erreur: ${error.message}`);
                    this.rl.close();
                    // Redemander la date en cas d'erreur
                    this.promptForResetDate().then(resolve).catch(reject);
                }
            });
        });
    }

    /**
     * Parse la date entrée par l'utilisateur au format DD-MM
     * @param {string} dateString - La date au format DD-MM
     * @returns {Date} La date parsée
     */
    parseResetDate(dateString) {
        const dateRegex = /^(\d{1,2})-(\d{1,2})$/;
        const match = dateString.match(dateRegex);

        if (!match) {
            throw new Error('Format invalide. Utilisez le format DD-MM (exemple: 15-08)');
        }

        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);

        // Validation des valeurs
        if (day < 1 || day > 31) {
            throw new Error('Le jour doit être entre 1 et 31');
        }

        if (month < 1 || month > 12) {
            throw new Error('Le mois doit être entre 1 et 12');
        }

        // Créer la date pour cette année
        const currentYear = new Date().getFullYear();
        const resetDate = new Date(currentYear, month - 1, day, 0, 0, 0, 0);

        // Si la date est dans le passé, utiliser l'année suivante
        const now = new Date();
        if (resetDate <= now) {
            resetDate.setFullYear(currentYear + 1);
        }

        // Validation de la date (pour les jours invalides comme 31 février)
        if (resetDate.getDate() !== day || resetDate.getMonth() !== month - 1) {
            throw new Error('Date invalide (exemple: 31 février n\'existe pas)');
        }

        return resetDate;
    }

    /**
     * Configure le système de reset avec la date fournie
     * @param {Date} resetDate - La date du prochain reset
     * @returns {Promise<boolean>} True si la configuration a réussi
     */
    async configureReset(resetDate) {
        try {
            const timestamp = Math.floor(resetDate.getTime() / 1000);
            await dbManager.setNextResetDate(timestamp);
            
            console.log(`✅ Date de reset configurée: ${resetDate.toLocaleDateString('fr-FR', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })}`);
            
            const daysUntilReset = Math.ceil((resetDate - new Date()) / (1000 * 60 * 60 * 24));
            console.log(`⏰ Reset dans ${daysUntilReset} jour(s)`);
            console.log('🔄 Les resets suivants auront lieu tous les 14 jours à partir de cette date.\n');
            
            return true;
        } catch (error) {
            logger.error('Erreur lors de la configuration du reset:', error);
            console.log('❌ Erreur lors de la sauvegarde de la configuration.');
            return false;
        }
    }

    /**
     * Vérifie si une configuration de reset existe déjà
     * @returns {Promise<boolean>} True si une configuration existe
     */
    async hasResetConfig() {
        try {
            const config = await dbManager.getResetConfig();
            return config && config.nextResetDate;
        } catch (error) {
            logger.error('Erreur lors de la vérification de la configuration:', error);
            return false;
        }
    }

    /**
     * Processus complet de configuration du reset
     * @returns {Promise<boolean>} True si la configuration a réussi
     */
    async setupReset() {
        try {
            // Vérifier si une configuration existe déjà
            const hasConfig = await this.hasResetConfig();
            if (hasConfig) {
                const config = await dbManager.getResetConfig();
                const resetDate = new Date(config.nextResetDate * 1000);
                console.log(`ℹ️  Configuration de reset existante trouvée:`);
                console.log(`📅 Prochain reset: ${resetDate.toLocaleDateString('fr-FR', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })}\n`);
                return true;
            }

            // Demander la date à l'utilisateur
            const resetDate = await this.promptForResetDate();
            
            // Configurer le système avec cette date
            return await this.configureReset(resetDate);
        } catch (error) {
            logger.error('Erreur lors de la configuration du reset:', error);
            console.log('❌ Échec de la configuration du système de reset.');
            return false;
        }
    }

    /**
     * Nettoie les ressources
     */
    cleanup() {
        if (this.rl) {
            this.rl.close();
        }
    }
}

module.exports = ResetPrompt;
