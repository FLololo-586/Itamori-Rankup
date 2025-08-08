const { setTimeout: sleep } = require('timers/promises');
const logger = require('./logger');
const { dbManager } = require('../../database');
class Scheduler {
    constructor(client) {
        this.client = client;
        this.jobs = new Map();
    }
    /**
     * Calcule la date de la prochaine réinitialisation bimensuelle
     * La réinitialisation a lieu tous les 14 jours à partir du démarrage du bot
     * @returns {Object} Un objet contenant la date de la prochaine réinitialisation et le temps d'attente en ms
     */
    calculateNextReset() {
        const maintenant = new Date();
        const dateDebut = this.client.readyAt || maintenant; 
        const tempsEcoule = maintenant - dateDebut;
        const deuxSemainesEnMs = 14 * 24 * 60 * 60 * 1000; 
        const tempsJusquProchaineReinit = deuxSemainesEnMs - (tempsEcoule % deuxSemainesEnMs);
        const prochaineReinit = new Date(maintenant.getTime() + tempsJusquProchaineReinit);
        return {
            date: prochaineReinit,
            delai: tempsJusquProchaineReinit
        };
    }
    /**
     * Planifie la réinitialisation bimensuelle
     */
    scheduleBiWeeklyReset() {
        this.cancelJob('biWeeklyReset');
        const { date: prochaineReinit, delai: tempsAvantProchaineReinit } = this.calculateNextReset();
        logger.info(`Réinitialisation bimensuelle programmée pour le ${prochaineReinit.toISOString()} (dans ${Math.round(tempsAvantProchaineReinit / (1000 * 60 * 60 * 24))} jours)`);
        const timeoutId = setTimeout(async () => {
            try {
                logger.info('Début de la réinitialisation bimensuelle des statistiques...');
                const nombreReinitialises = await dbManager.resetAllUserStats();
                logger.info(`Réinitialisation bimensuelle terminée. Statistiques réinitialisées pour ${nombreReinitialises} utilisateurs.`);
                if (this.client.channels.cache.size > 0) {
                    const salon = this.client.channels.cache.find(
                        c => c.type === 0 && c.permissionsFor(this.client.user).has('SendMessages')
                    );
                    if (salon) {
                        await salon.send({
                            content: `🔄 **Réinitialisation bimensuelle terminée**\n✅ Les statistiques de messages et de temps vocal ont été réinitialisées pour ${nombreReinitialises} membres.`
                        }).catch(err => {
                            logger.error('Échec de l\'envoi du message de confirmation :', err);
                        });
                    }
                }
                this.scheduleBiWeeklyReset();
            } catch (erreur) {
                logger.error('Erreur lors de la réinitialisation bimensuelle :', erreur);
                setTimeout(() => this.scheduleBiWeeklyReset(), 60 * 60 * 1000);
            }
        }, tempsAvantProchaineReinit);
        this.jobs.set('biWeeklyReset', timeoutId);
    }
    /**
     * Annule une tâche planifiée
     * @param {string} nomTache - Nom de la tâche à annuler
     */
    cancelJob(nomTache) {
        const tache = this.jobs.get(nomTache);
        if (tache) {
            clearTimeout(tache);
            this.jobs.delete(nomTache);
        }
    }
    /**
     * Nettoie toutes les tâches planifiées
     */
    cleanup() {
        for (const [nomTache, tache] of this.jobs.entries()) {
            clearTimeout(tache);
            this.jobs.delete(nomTache);
        }
    }
}
module.exports = Scheduler;