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
     * Utilise la configuration stockée en base de données
     * @returns {Promise<Object>} Un objet contenant la date de la prochaine réinitialisation et le temps d'attente en ms
     */
    async calculateNextReset() {
        try {
            const config = await dbManager.getResetConfig();
            const maintenant = new Date();
            
            if (config && config.nextResetDate) {
                const prochaineReinit = new Date(config.nextResetDate * 1000);
                const tempsJusquProchaineReinit = prochaineReinit.getTime() - maintenant.getTime();
                
                // Si la date est dans le passé, calculer la prochaine date basée sur l'intervalle
                if (tempsJusquProchaineReinit <= 0) {
                    const intervalMs = (config.intervalDays || 14) * 24 * 60 * 60 * 1000;
                    const cyclesEcoules = Math.ceil(Math.abs(tempsJusquProchaineReinit) / intervalMs);
                    const nouvelleProchaineReinit = new Date(prochaineReinit.getTime() + (cyclesEcoules * intervalMs));
                    
                    // Mettre à jour la base de données avec la nouvelle date
                    await dbManager.updateNextResetDate(Math.floor(nouvelleProchaineReinit.getTime() / 1000));
                    
                    return {
                        date: nouvelleProchaineReinit,
                        delai: nouvelleProchaineReinit.getTime() - maintenant.getTime()
                    };
                }
                
                return {
                    date: prochaineReinit,
                    delai: tempsJusquProchaineReinit
                };
            }
            
            // Si aucune configuration n'existe, retourner null pour déclencher la demande de date
            return null;
        } catch (error) {
            logger.error('Erreur lors du calcul de la prochaine réinitialisation:', error);
            throw error;
        }
    }
    /**
     * Planifie la réinitialisation bimensuelle
     */
    async scheduleBiWeeklyReset() {
        this.cancelJob('biWeeklyReset');
        
        try {
            const resetInfo = await this.calculateNextReset();
            if (!resetInfo) {
                logger.warn('Aucune configuration de reset trouvée. La planification sera effectuée après la configuration.');
                return;
            }
            
            const { date: prochaineReinit, delai: tempsAvantProchaineReinit } = resetInfo;
            logger.info(`Réinitialisation bimensuelle programmée pour le ${prochaineReinit.toISOString()} (dans ${Math.round(tempsAvantProchaineReinit / (1000 * 60 * 60 * 24))} jours)`);
            
            const timeoutId = setTimeout(async () => {
                try {
                    logger.info('Début de la réinitialisation bimensuelle des statistiques...');
                    const nombreReinitialises = await dbManager.resetAllUserStats();
                    logger.info(`Réinitialisation bimensuelle terminée. Statistiques réinitialisées pour ${nombreReinitialises} utilisateurs.`);
                    
                    // Programmer la prochaine réinitialisation (14 jours plus tard)
                    const prochaineDate = new Date(prochaineReinit.getTime() + (14 * 24 * 60 * 60 * 1000));
                    await dbManager.updateNextResetDate(Math.floor(prochaineDate.getTime() / 1000));
                    
                    // Envoyer un message de confirmation si possible
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
                    
                    // Programmer la prochaine réinitialisation
                    this.scheduleBiWeeklyReset();
                } catch (erreur) {
                    logger.error('Erreur lors de la réinitialisation bimensuelle :', erreur);
                    // Réessayer dans 1 heure en cas d'erreur
                    setTimeout(() => this.scheduleBiWeeklyReset(), 60 * 60 * 1000);
                }
            }, tempsAvantProchaineReinit);
            
            this.jobs.set('biWeeklyReset', timeoutId);
        } catch (error) {
            logger.error('Erreur lors de la planification de la réinitialisation:', error);
            // Réessayer dans 1 heure en cas d'erreur
            setTimeout(() => this.scheduleBiWeeklyReset(), 60 * 60 * 1000);
        }
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