module.exports = {
    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const incidents = await IncidentModel.find(query)
                .limit(limit)
                .skip(skip)
                .populate('acknowledgedBy', 'name')
                .populate('resolvedBy', 'name')
                .populate('createdById', 'name')
                .populate('projectId', 'name')
                .populate('probes.probeId')
                .populate('incidentPriority', 'name color')
                .populate({
                    path: 'monitors.monitorId',
                    populate: [
                        { path: 'componentId', select: '_id name slug' },
                        { path: 'projectId', select: '_id name slug' },
                    ],
                })
                .populate('acknowledgedByIncomingHttpRequest', 'name')
                .populate('resolvedByIncomingHttpRequest', 'name')
                .populate('createdByIncomingHttpRequest', 'name')
                .populate({
                    path: 'breachedCommunicationSlas.monitorId',
                    populate: [
                        {
                            path: 'componentId',
                            select: 'name slug',
                        },
                        { path: 'projectId', select: '_id name slug' },
                    ],
                })
                .sort({ createdAt: 'desc' });
            return incidents;
        } catch (error) {
            ErrorService.log('incidentService.findBy', error);
            throw error;
        }
    },

    create: async function(data) {
        try {
            const _this = this;

            if (!data.monitors || data.monitors.length === 0) {
                const error = new Error(
                    'You need at least one monitor to create an incident'
                );
                error.code = 400;
                throw error;
            }
            if (!isArrayUnique(data.monitors)) {
                const error = new Error(
                    'You cannot have multiple selection of the same monitor'
                );
                error.code = 400;
                throw error;
            }

            let monitors = await MonitorService.findBy({
                _id: { $in: data.monitors },
            });
            monitors = monitors
                .filter(monitor => !monitor.disabled)
                .map(monitor => ({
                    monitorId: monitor._id,
                }));
            if (monitors.length === 0) {
                const error = new Error(
                    'You need at least one enabled monitor to create an incident'
                );
                error.code = 400;
                throw error;
            }

            const { matchedCriterion } = data;

            const project = await ProjectService.findOneBy({
                _id: data.projectId,
            });
            const users =
                project && project.users && project.users.length
                    ? project.users.map(({ userId }) => userId)
                    : [];

            let errorMsg;
            if (data.customFields && data.customFields.length > 0) {
                for (const field of data.customFields) {
                    if (
                        field.uniqueField &&
                        field.fieldValue &&
                        field.fieldValue.trim()
                    ) {
                        const incident = await _this.findOneBy({
                            customFields: {
                                $elemMatch: {
                                    fieldName: field.fieldName,
                                    fieldType: field.fieldType,
                                    fieldValue: field.fieldValue,
                                },
                            },
                        });

                        if (incident) {
                            errorMsg = `The field ${field.fieldName} must be unique for all incidents`;
                        }
                    }
                }
            }

            if (errorMsg) {
                const error = new Error(errorMsg);
                error.code = 400;
                throw error;
            }

            let incident = new IncidentModel();
            const incidentsCountInProject = await _this.countBy({
                projectId: data.projectId,
            });
            const deletedIncidentsCountInProject = await _this.countBy({
                projectId: data.projectId,
                deleted: true,
            });

            incident.projectId = data.projectId || null;
            incident.monitors = monitors;
            incident.createdById = data.createdById || null;
            incident.notClosedBy = users;
            incident.incidentType = data.incidentType;
            incident.manuallyCreated = data.manuallyCreated || false;
            if (data.reason && data.reason.length > 0) {
                incident.reason = data.reason.join('\n');
            }
            incident.response = data.response || null;
            incident.idNumber =
                incidentsCountInProject + deletedIncidentsCountInProject + 1;
            incident.customFields = data.customFields;
            incident.createdByIncomingHttpRequest =
                data.createdByIncomingHttpRequest;

            if (!incident.manuallyCreated) {
                const incidentSettings = await IncidentSettingsService.findOne({
                    projectId: data.projectId,
                });

                // ****** TODO ********
                // handle more than one monitors for this
                // fix the template
                // ********************
                const templatesInput = {
                    incidentType: data.incidentType,
                    projectName: project.name,
                    time: Moment().format('h:mm:ss a'),
                    date: Moment().format('MMM Do YYYY'),
                    monitors: monitors.map(monitor => monitor.monitorId),
                };

                const titleTemplate = Handlebars.compile(
                    incidentSettings.title
                );
                const descriptionTemplate = Handlebars.compile(
                    incidentSettings.description
                );

                incident.title =
                    matchedCriterion && matchedCriterion.title
                        ? matchedCriterion.title
                        : titleTemplate(templatesInput);
                incident.description =
                    matchedCriterion && matchedCriterion.description
                        ? matchedCriterion.description
                        : descriptionTemplate(templatesInput);
                incident.criterionCause = {
                    ...matchedCriterion,
                };

                incident.incidentPriority = incidentSettings.incidentPriority;

                if (data.probeId) {
                    incident.probes = [
                        {
                            probeId: data.probeId,
                            updatedAt: Date.now(),
                            status: true,
                            reportedStatus: data.incidentType,
                        },
                    ];
                }
            } else {
                incident.title = data.title;
                incident.description = data.description;
                incident.incidentPriority = data.incidentPriority;
            }

            incident = await incident.save();
            incident = await _this.findOneBy({ _id: incident._id });

            // ********* TODO ************
            // notification is an array of notifications
            // ***************************
            const notifications = await _this._sendIncidentCreatedAlert(
                incident
            );

            incident.notifications = notifications.map(notification => ({
                notificationId: notification._id,
            }));
            incident = await incident.save();

            await RealTimeService.sendCreatedIncident(incident);

            await IncidentTimelineService.create({
                incidentId: incident._id,
                createdById: data.createdById,
                probeId: data.probeId,
                status: data.incidentType,
            });

            // ********* TODO ************
            // handle multiple monitors for this
            // it should now accept array of monitors id
            // ***************************
            _this.startInterval(data.projectId, monitors, incident);

            return incident;
        } catch (error) {
            ErrorService.log('incidentService.create', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await IncidentModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('incidentService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const incident = await IncidentModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            });

            if (incident) {
                for (const monitor of incident.monitors) {
                    this.clearInterval(
                        incident._id,
                        monitor.monitorId._id || monitor.monitorId
                    ); // clear any existing sla interval
                }

                const monitorStatuses = await MonitorStatusService.findBy({
                    incidentId: incident._id,
                });
                for (const monitorStatus of monitorStatuses) {
                    const { _id } = monitorStatus;
                    await MonitorStatusService.deleteBy({ _id }, userId);
                }
                const incidentTimeline = await IncidentTimelineService.findBy({
                    incidentId: incident._id,
                });
                for (const event of incidentTimeline) {
                    await IncidentTimelineService.deleteBy(
                        { _id: event._id },
                        userId
                    );
                }
            }
            return incident;
        } catch (error) {
            ErrorService.log('incidentService.deleteBy', error);
            throw error;
        }
    },

    // Description: Get Incident by incident Id.
    // Params:
    // Param 1: monitorId: monitor Id
    // Returns: promise with incident or error.
    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const incident = await IncidentModel.findOne(query)
                .populate('acknowledgedBy', 'name')
                .populate('resolvedBy', 'name')
                .populate('createdById', 'name')
                .populate('incidentPriority', 'name color')
                .populate('probes.probeId')
                .populate('acknowledgedByIncomingHttpRequest', 'name')
                .populate('resolvedByIncomingHttpRequest', 'name')
                .populate('createdByIncomingHttpRequest', 'name')
                .populate({
                    path: 'monitors.monitorId',
                    populate: [
                        {
                            path: 'componentId',
                            select: 'name slug',
                        },
                        { path: 'projectId', select: '_id name slug' },
                    ],
                })
                .populate({
                    path: 'breachedCommunicationSlas.monitorId',
                    populate: [
                        {
                            path: 'componentId',
                            select: 'name slug',
                        },
                        { path: 'projectId', select: '_id name slug' },
                    ],
                });
            return incident;
        } catch (error) {
            ErrorService.log('incidentService.findOne', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const _this = this;
            const oldIncident = await _this.findOneBy({
                _id: query._id,
                deleted: { $ne: null },
            });

            const notClosedBy = oldIncident && oldIncident.notClosedBy;
            if (data.notClosedBy) {
                data.notClosedBy = notClosedBy.concat(data.notClosedBy);
            }
            data.manuallyCreated =
                data.manuallyCreated ||
                (oldIncident && oldIncident.manuallyCreated) ||
                false;

            if (
                data.reason &&
                Array.isArray(data.reason) &&
                data.reason.length > 0
            ) {
                data.reason = data.reason.join('\n');
            }

            let updatedIncident = await IncidentModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                { new: true }
            );
            updatedIncident = await updatedIncident
                .populate('acknowledgedBy', 'name')
                .populate('monitorId', 'name')
                .populate('resolvedBy', 'name')
                .populate('createdById', 'name')
                .populate('probes.probeId')
                .populate('incidentPriority', 'name color')
                .populate({
                    path: 'monitors.monitorId',
                    populate: [
                        { path: 'componentId', select: '_id name slug' },
                        { path: 'projectId', select: '_id name slug' },
                    ],
                })
                .populate('acknowledgedByIncomingHttpRequest', 'name')
                .populate('resolvedByIncomingHttpRequest', 'name')
                .populate('createdByIncomingHttpRequest', 'name')
                .populate({
                    path: 'breachedCommunicationSlas.monitorId',
                    populate: [
                        {
                            path: 'componentId',
                            select: 'name slug',
                        },
                        { path: 'projectId', select: '_id name slug' },
                    ],
                })
                .execPopulate();

            RealTimeService.updateIncident(updatedIncident);

            return updatedIncident;
        } catch (error) {
            ErrorService.log('incidentService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await IncidentModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('incidentService.updateMany', error);
            throw error;
        }
    },

    async _sendIncidentCreatedAlert(incident) {
        try {
            await ZapierService.pushToZapier('incident_created', incident);
            // await RealTimeService.sendCreatedIncident(incident);

            // assuming that all the monitors must be in the same component
            // having multiple components will make it more complicated
            const selectedComponentId =
                incident.monitors[0] &&
                incident.monitors[0].monitorId.componentId._id;
            const component = selectedComponentId
                ? await ComponentService.findOneBy({
                      _id: selectedComponentId,
                  })
                : {};

            const meta = {
                type: 'Incident',
                componentId: selectedComponentId,
                incidentId: incident._id,
            };
            const notifications = [];

            const monitors = incident.monitors.map(
                monitor => monitor.monitorId
            );
            for (const monitor of monitors) {
                await AlertService.sendCreatedIncident(incident, monitor);
                // handle this asynchronous operation in the background
                AlertService.sendCreatedIncidentToSubscribers(
                    incident,
                    component,
                    monitor
                );

                let notification = {};
                // send slack notification
                SlackService.sendNotification(
                    incident.projectId,
                    incident,
                    monitor,
                    INCIDENT_CREATED,
                    component
                );
                // send webhook notification
                WebHookService.sendIntegrationNotification(
                    incident.projectId,
                    incident,
                    monitor,
                    INCIDENT_CREATED,
                    component
                );
                // send Ms Teams notification
                MsTeamsService.sendNotification(
                    incident.projectId,
                    incident,
                    monitor,
                    INCIDENT_CREATED,
                    component
                );

                if (!incident.createdById) {
                    if (incident.createdByIncomingHttpRequest) {
                        const msg = `New ${incident.incidentType} Incident was created for ${monitor.name} by Incoming HTTP Request`;
                        notification = await NotificationService.create(
                            incident.projectId,
                            msg,
                            'incoming http request',
                            'warning',
                            meta
                        );
                    } else {
                        const msg = `New ${incident.incidentType} Incident was created for ${monitor.name} by Fyipe`;
                        notification = await NotificationService.create(
                            incident.projectId,
                            msg,
                            'fyipe',
                            'warning',
                            meta
                        );
                    }
                } else {
                    const msg = `New ${incident.incidentType} Incident was created for ${monitor.name} by ${incident.createdById.name}`;
                    notification = await NotificationService.create(
                        incident.projectId,
                        msg,
                        incident.createdById.name,
                        'warning',
                        meta
                    );
                }

                notifications.push(notification);
            }
            return notifications;
        } catch (error) {
            ErrorService.log(
                'incidentService._sendIncidentCreatedAlert',
                error
            );
            throw error;
        }
    },

    /**
     * @param {object} incidentId incident id
     * @param {string} userId Id of user performing the action.
     * @param {string} name Name of user performing the action.
     * @returns {object} Promise with incident or error.
     */
    acknowledge: async function(
        incidentId,
        userId,
        name,
        probeId,
        zapier,
        httpRequest = {}
    ) {
        try {
            const _this = this;
            let incident = await _this.findOneBy({
                _id: incidentId,
                acknowledged: false,
            });
            if (incident) {
                incident = await _this.updateOneBy(
                    {
                        _id: incident._id,
                    },
                    {
                        acknowledged: true,
                        acknowledgedBy: userId,
                        acknowledgedAt: Date.now(),
                        acknowledgedByZapier: zapier,
                        acknowledgedByIncomingHttpRequest: httpRequest._id,
                    }
                );

                const downtimestring = IncidentUtilitiy.calculateHumanReadableDownTime(
                    incident.createdAt
                );

                if (isEmpty(httpRequest)) {
                    NotificationService.create(
                        incident.projectId,
                        `An Incident was acknowledged by ${name}`,
                        userId,
                        'acknowledge'
                    );
                } else {
                    NotificationService.create(
                        incident.projectId,
                        `An Incident was acknowledged by an incoming HTTP request ${httpRequest.name}`,
                        userId,
                        'acknowledge'
                    );
                }

                incident = await _this.findOneBy({ _id: incident._id });

                // Ping webhook
                const monitors = incident.monitors.map(
                    monitor => monitor.monitorId
                );

                // assuming all the monitors in the incident is from the same component
                // which makes sense, since having multiple component will make things more complicated
                const component = await ComponentService.findOneBy({
                    _id:
                        monitors[0] &&
                        monitors[0].componentId &&
                        monitors[0].componentId._id
                            ? monitors[0].componentId._id
                            : monitors[0].componentId,
                });

                // automatically create acknowledgement incident note
                IncidentMessageService.create({
                    content: 'This incident has been acknowledged',
                    incidentId,
                    createdById: userId,
                    type: 'investigation',
                    incident_state: 'Acknowledged',
                    post_statuspage: true,
                    monitors,
                });

                await IncidentTimelineService.create({
                    incidentId: incidentId,
                    createdById: userId,
                    probeId: probeId,
                    createdByZapier: zapier,
                    status: 'acknowledged',
                });

                for (const monitor of monitors) {
                    _this.refreshInterval(incidentId, monitor._id);

                    WebHookService.sendIntegrationNotification(
                        incident.projectId,
                        incident,
                        monitor,
                        INCIDENT_ACKNOWLEDGED,
                        component,
                        downtimestring
                    );

                    SlackService.sendNotification(
                        incident.projectId,
                        incident,
                        monitor,
                        INCIDENT_ACKNOWLEDGED,
                        component,
                        downtimestring
                    );

                    MsTeamsService.sendNotification(
                        incident.projectId,
                        incident,
                        monitor,
                        INCIDENT_ACKNOWLEDGED,
                        component,
                        downtimestring
                    );

                    await AlertService.sendAcknowledgedIncidentToSubscribers(
                        incident,
                        monitor
                    );
                    await AlertService.sendAcknowledgedIncidentMail(
                        incident,
                        monitor
                    );
                }

                RealTimeService.incidentAcknowledged(incident);
                ZapierService.pushToZapier('incident_acknowledge', incident);
            } else {
                incident = await _this.findOneBy({
                    _id: incidentId,
                    acknowledged: true,
                });
            }

            return incident;
        } catch (error) {
            ErrorService.log('incidentService.acknowledge', error);
            throw error;
        }
    },

    // Description: Update user who resolved incident.
    // Params:
    // Param 1: data: {incidentId}
    // Returns: promise with incident or error.
    resolve: async function(
        incidentId,
        userId,
        name,
        probeId,
        zapier,
        httpRequest = {}
    ) {
        try {
            const _this = this;
            const data = {};
            let incident = await _this.findOneBy({ _id: incidentId });

            if (!incident) {
                return;
            }

            if (!incident.acknowledged) {
                data.acknowledged = true;
                data.acknowledgedBy = userId;
                data.acknowledgedAt = Date.now();
                data.acknowledgedByZapier = zapier;
                data.acknowledgedByIncomingHttpRequest = httpRequest._id;

                await IncidentTimelineService.create({
                    incidentId: incidentId,
                    createdById: userId,
                    probeId: probeId,
                    createdByZapier: zapier,
                    status: 'acknowledged',
                });
            }
            data.resolved = true;
            data.resolvedBy = userId;
            data.resolvedAt = Date.now();
            data.resolvedByZapier = zapier;
            data.resolvedByIncomingHttpRequest = httpRequest._id;

            incident = await _this.updateOneBy({ _id: incidentId }, data);

            incident = await _this.findOneBy({ _id: incident._id });

            const monitors = incident.monitors.map(
                monitor => monitor.monitorId
            );

            // automatically create resolved incident note
            IncidentMessageService.create({
                content: 'This incident has been resolved',
                incidentId,
                createdById: userId,
                type: 'investigation',
                incident_state: 'Resolved',
                post_statuspage: true,
                monitors,
            });

            await IncidentTimelineService.create({
                incidentId: incidentId,
                createdById: userId,
                probeId: probeId,
                createdByZapier: zapier,
                status: 'resolved',
            });

            for (const monitor of monitors) {
                _this.clearInterval(incidentId, monitor._id);

                if (incident.probes && incident.probes.length > 0) {
                    for (const probe of incident.probes) {
                        await MonitorStatusService.create({
                            monitorId: monitor._id,
                            probeId: probe.probeId ? probe.probeId._id : null,
                            manuallyCreated: userId ? true : false,
                            status: 'online',
                        });
                    }
                } else {
                    await MonitorStatusService.create({
                        monitorId: monitor._id,
                        probeId,
                        manuallyCreated: userId ? true : false,
                        status: 'online',
                    });
                }

                await _this.sendIncidentResolvedNotification(
                    incident,
                    name,
                    monitor
                );
            }

            RealTimeService.incidentResolved(incident);
            ZapierService.pushToZapier('incident_resolve', incident);

            return incident;
        } catch (error) {
            ErrorService.log('incidentService.resolve', error);
            throw error;
        }
    },

    //
    close: async function(incidentId, userId) {
        try {
            const incident = await IncidentModel.findByIdAndUpdate(incidentId, {
                $pull: { notClosedBy: userId },
            });

            return incident;
        } catch (error) {
            ErrorService.log('incidentService.close', error);
            throw error;
        }
    },

    getUnresolvedIncidents: async function(subProjectIds, userId) {
        const _this = this;
        let incidentsUnresolved = await _this.findBy({
            projectId: { $in: subProjectIds },
            resolved: false,
        });
        incidentsUnresolved = incidentsUnresolved.map(incident => {
            if (incident.notClosedBy.indexOf(userId) < 0) {
                return _this.updateOneBy(
                    { _id: incident._id },
                    { notClosedBy: [userId] }
                );
            } else {
                return incident;
            }
        });
        await Promise.all(incidentsUnresolved);
        incidentsUnresolved = await _this.findBy({
            projectId: { $in: subProjectIds },
            resolved: false,
        });
        const incidentsResolved = await _this.findBy({
            projectId: { $in: subProjectIds },
            resolved: true,
            notClosedBy: userId,
        });

        return incidentsUnresolved.concat(incidentsResolved);
    },

    getSubProjectIncidents: async function(subProjectIds) {
        const _this = this;
        const subProjectIncidents = await Promise.all(
            subProjectIds.map(async id => {
                const incidents = await _this.findBy({ projectId: id }, 10, 0);
                const count = await _this.countBy({ projectId: id });
                return { incidents, count, _id: id, skip: 0, limit: 10 };
            })
        );
        return subProjectIncidents;
    },

    getComponentIncidents: async function(projectId, componentId) {
        const _this = this;
        const monitors = await MonitorService.findBy({
            projectId,
            componentId,
        });
        const monitorIds = monitors.map(monitor => monitor._id);

        const query = {
            'monitors.monitorId': { $in: monitorIds },
        };
        const incidents = await _this.findBy(query, 10, 0);
        const count = await _this.countBy(query);
        const componentIncidents = [
            { incidents, _id: projectId, count, skip: 0, limit: 10 },
        ];
        return componentIncidents;
    },

    getProjectComponentIncidents: async function(
        projectId,
        componentId,
        limit,
        skip
    ) {
        const _this = this;
        const monitors = await MonitorService.findBy({
            componentId: componentId,
        });
        const monitorIds = monitors.map(monitor => monitor._id);

        const query = {
            projectId,
            'monitors.monitorId': { $in: monitorIds },
        };
        const incidents = await _this.findBy(query, limit, skip);
        const count = await _this.countBy(query);
        return { incidents, count, _id: projectId };
    },
    sendIncidentResolvedNotification: async function(incident, name, monitor) {
        try {
            const _this = this;
            const component = await ComponentService.findOneBy({
                _id:
                    monitor.componentId && monitor.componentId._id
                        ? monitor.componentId._id
                        : monitor.componentId,
            });
            const resolvedincident = await _this.findOneBy({
                _id: incident._id,
            });
            const downtimestring = IncidentUtilitiy.calculateHumanReadableDownTime(
                resolvedincident.createdAt
            );

            // send slack notification
            SlackService.sendNotification(
                incident.projectId,
                incident,
                monitor,
                INCIDENT_RESOLVED,
                component,
                downtimestring
            );
            // Ping webhook
            WebHookService.sendIntegrationNotification(
                incident.projectId,
                incident,
                monitor,
                INCIDENT_RESOLVED,
                component,
                downtimestring
            );
            // Ms Teams
            MsTeamsService.sendNotification(
                incident.projectId,
                incident,
                monitor,
                INCIDENT_RESOLVED,
                component,
                downtimestring
            );

            // send notificaton to subscribers
            await AlertService.sendResolvedIncidentToSubscribers(
                incident,
                monitor
            );
            await AlertService.sendResolveIncidentMail(incident, monitor);

            const msg = `${
                monitor.name
            } monitor was down for ${downtimestring} and is now resolved by ${name ||
                (resolvedincident.resolvedBy &&
                    resolvedincident.resolvedBy.name) ||
                'fyipe'}`;

            NotificationService.create(
                incident.projectId,
                msg,
                resolvedincident.resolvedBy
                    ? resolvedincident.resolvedBy._id
                    : 'fyipe',
                'success'
            );
        } catch (error) {
            ErrorService.log(
                'incidentService.sendIncidentResolvedNotification',
                error
            );
            throw error;
        }
    },

    sendIncidentNoteAdded: async function(projectId, incident, data) {
        try {
            const monitors = incident.monitors.map(
                monitor => monitor.monitorId
            );
            for (const monitor of monitors) {
                await SlackService.sendIncidentNoteNotification(
                    projectId,
                    incident,
                    data,
                    monitor
                );

                await MsTeamsService.sendIncidentNoteNotification(
                    projectId,
                    incident,
                    data,
                    monitor
                );
            }

            await ZapierService.pushToZapier('incident_note', incident, data);
        } catch (error) {
            ErrorService.log('incidentService.sendIncidentNoteAdded', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await IncidentModel.deleteMany(query);
            return 'Incident(s) removed successfully!';
        } catch (error) {
            ErrorService.log('incidentService.deleteMany', error);
            throw error;
        }
    },

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;
        let incident = await _this.findBy(query);
        if (incident && incident.length > 0) {
            const incidents = await Promise.all(
                incident.map(async incident => {
                    const incidentId = incident._id;
                    incident = await _this.updateOneBy(
                        {
                            _id: incidentId,
                            deleted: true,
                        },
                        {
                            deleted: false,
                            deletedAt: null,
                            deleteBy: null,
                        }
                    );
                    return incident;
                })
            );
            return incidents;
        } else {
            incident = incident[0];
            if (incident) {
                const incidentId = incident._id;
                incident = await _this.updateOneBy(
                    {
                        _id: incidentId,
                    },
                    {
                        deleted: false,
                        deletedAt: null,
                        deleteBy: null,
                    }
                );
            }
            return incident;
        }
    },

    /**
     * @description removes a particular monitor from incident and deletes the incident
     * @param {string} monitorId the id of the monitor
     * @param {string} userId the id of the user
     */
    removeMonitor: async function(monitorId, userId) {
        try {
            const incidents = await this.findBy({
                'monitors.monitorId': monitorId,
            });

            await Promise.all(
                incidents.map(async incident => {
                    // only delete the incident, since the monitor can be restored
                    const monitors = incident.monitors
                        .map(
                            monitor =>
                                monitor.monitorId._id || monitor.monitorId
                        )
                        .filter(id => String(id) !== String(monitorId));

                    let updatedIncident = null;
                    if (monitors.length === 0) {
                        // no more monitor in monitors array
                        // delete incident
                        updatedIncident = await IncidentModel.findOneAndUpdate(
                            {
                                _id: incident._id,
                            },
                            {
                                $set: {
                                    deleted: true,
                                    deletedAt: Date.now(),
                                    deletedById: userId,
                                    monitors,
                                },
                            },
                            { new: true }
                        );
                    } else {
                        updatedIncident = await IncidentModel.findOneAndUpdate(
                            {
                                _id: incident._id,
                            },
                            {
                                $set: {
                                    monitors,
                                },
                            },
                            { new: true }
                        );
                    }

                    updatedIncident = await updatedIncident
                        .populate('acknowledgedBy', 'name')
                        .populate('monitorId', 'name')
                        .populate('resolvedBy', 'name')
                        .populate('createdById', 'name')
                        .populate('probes.probeId')
                        .populate('incidentPriority', 'name color')
                        .populate({
                            path: 'monitors.monitorId',
                            populate: [
                                {
                                    path: 'componentId',
                                    select: '_id name slug',
                                },
                                { path: 'projectId', select: '_id name slug' },
                            ],
                        })
                        .populate('acknowledgedByIncomingHttpRequest', 'name')
                        .populate('resolvedByIncomingHttpRequest', 'name')
                        .populate('createdByIncomingHttpRequest', 'name')
                        .populate({
                            path: 'breachedCommunicationSlas.monitorId',
                            populate: [
                                {
                                    path: 'componentId',
                                    select: 'name slug',
                                },
                                { path: 'projectId', select: '_id name slug' },
                            ],
                        })
                        .execPopulate();

                    await RealTimeService.deleteIncident(updatedIncident);
                })
            );
        } catch (error) {
            ErrorService.log('incidentService.removeMonitor', error);
            throw error;
        }
    },

    startInterval: async function(projectId, monitors, incident) {
        const _this = this;

        monitors = monitors.map(monitor => monitor.monitorId);
        const monitorList = await MonitorService.findBy({
            _id: { $in: monitors },
        });
        for (const monitor of monitorList) {
            let incidentCommunicationSla = monitor.incidentCommunicationSla;

            if (!incidentCommunicationSla) {
                incidentCommunicationSla = await IncidentCommunicationSlaService.findOneBy(
                    {
                        projectId: projectId,
                        isDefault: true,
                    }
                );
            }

            if (incidentCommunicationSla && !incidentCommunicationSla.deleted) {
                let countDown = incidentCommunicationSla.duration * 60;
                const alertTime = incidentCommunicationSla.alertTime * 60;

                const data = {
                    projectId,
                    monitor,
                    incidentCommunicationSla,
                    incident,
                    alertTime,
                };

                // count down every second
                const intervalId = setInterval(async () => {
                    countDown -= 1;

                    // const minutes = Math.floor(countDown / 60);
                    // let seconds = countDown % 60;
                    // seconds =
                    //     seconds < 10 && seconds !== 0 ? `0${seconds}` : seconds;
                    await RealTimeService.sendSlaCountDown(
                        incident,
                        `${countDown}`,
                        monitor
                    );

                    if (countDown === alertTime) {
                        // send mail to team
                        await AlertService.sendSlaEmailToTeamMembers(data);
                    }

                    if (countDown === 0) {
                        _this.clearInterval(incident._id, monitor._id);

                        // refetch the incident
                        const currentIncident = await _this.findOneBy({
                            _id: incident._id,
                        });
                        const breachedCommunicationSlas = currentIncident.breachedCommunicationSlas
                            ? currentIncident.breachedCommunicationSlas.map(
                                  breach => ({
                                      monitorId:
                                          breach.monitorId._id ||
                                          breach.monitorId,
                                  })
                              )
                            : [];
                        breachedCommunicationSlas.push({
                            monitorId: monitor._id,
                        });

                        await _this.updateOneBy(
                            { _id: incident._id },
                            { breachedCommunicationSlas }
                        );

                        // send mail to team
                        await AlertService.sendSlaEmailToTeamMembers(
                            data,
                            true
                        );
                    }
                }, 1000);

                intervals.push({
                    incidentId: incident._id,
                    monitorId: monitor._id,
                    intervalId,
                });
            }
        }
    },

    clearInterval: function(incidentId, monitorId) {
        intervals = intervals.filter(interval => {
            if (String(interval.monitorId) === String(monitorId)) {
                clearInterval(interval.intervalId);
                return false;
            }
            return true;
        });
    },

    refreshInterval: async function(incidentId, monitorId) {
        const _this = this;
        for (const interval of intervals) {
            if (String(interval.monitorId) === String(monitorId)) {
                _this.clearInterval(incidentId, monitorId);

                const incident = await _this.findOneBy({ _id: monitorId });
                _this.startInterval(
                    incident.projectId,
                    incident.monitors,
                    incident
                );
            }
        }
    },
};

/**
 * @description checks if an array contains duplicate values
 * @param {array} myArray the array to be checked
 * @returns {boolean} true or false
 */
function isArrayUnique(myArray) {
    return myArray.length === new Set(myArray).size;
}

let intervals = [];

const IncidentModel = require('../models/incident');
const IncidentTimelineService = require('./incidentTimelineService');
const MonitorService = require('./monitorService');
const AlertService = require('./alertService');
const RealTimeService = require('./realTimeService');
const NotificationService = require('./notificationService');
const WebHookService = require('./webHookService');
const MsTeamsService = require('./msTeamsService');
const SlackService = require('./slackService');
const ZapierService = require('./zapierService');
const ProjectService = require('./projectService');
const ErrorService = require('./errorService');
const MonitorStatusService = require('./monitorStatusService');
const ComponentService = require('./componentService');
const IncidentSettingsService = require('./incidentSettingsService');
const Handlebars = require('handlebars');
const Moment = require('moment');
const IncidentMessageService = require('./incidentMessageService');
const {
    INCIDENT_CREATED,
    INCIDENT_ACKNOWLEDGED,
    INCIDENT_RESOLVED,
} = require('../constants/incidentEvents');
const IncidentUtilitiy = require('../utils/incident');
const IncidentCommunicationSlaService = require('./incidentCommunicationSlaService');
const { isEmpty } = require('lodash');
