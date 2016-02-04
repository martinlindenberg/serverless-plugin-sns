'use strict';

module.exports = function(SPlugin) {

    const AWS      = require('aws-sdk'),
        path       = require('path'),
        fs         = require('fs'),
        BbPromise  = require('bluebird'); // Serverless uses Bluebird Promises and we recommend you do to because they provide more than your average Promise :)

    class ServerlessPluginSNS extends SPlugin {
        constructor(S) {
            super(S);
        }

        static getName() {
            return 'com.serverless.' + ServerlessPluginSNS.name;
        }

        registerHooks() {

            this.S.addHook(this._addSNSAfterDeploy.bind(this), {
                action: 'functionDeploy',
                event:  'post'
            });
            this.S.addHook(this._addSNSAfterDeploy.bind(this), {
                action: 'dashDeploy',
                event:  'post'
            });

            return BbPromise.resolve();
        }

        /**
         * adds alerts after the deployment of a function
         *
         * @param object evt
         *
         * @return promise
         */
        _addSNSAfterDeploy(evt) {
            let _this = this;

            return new BbPromise(function(resolve, reject) {
                for(var region in evt.data.deployed) {
                    _this._manageSNS(evt, region);
                }

                return resolve(evt);
            });
        }

        /**
         * Handles the Creation of an alert and the required topics
         *
         * @param object evt Event
         * @param string region
         *
         * @return promise
         */
        _manageSNS (evt, region) {
            let _this = this;

            _this.stage = evt.options.stage;
            _this._initAws(region);

            if (_this.S.cli.action != 'deploy' || (_this.S.cli.context != 'function' && _this.S.cli.context != 'dash'))
                return;

            _this.functionSNSSettings = _this._getFunctionsSNSSettings(evt, region);

            // no sns.json found
            if (_this.functionSNSSettings.length == 0) {
                return;
            }

            _this._manageTopics(_this.functionSNSSettings)
            .then(function(){
                let _this = this;
                _this._bindFunctions(_this.functionSNSSettings);
            }.bind(_this))
            .catch(function(e){
                console.log('error in manage topics', e)
            });
        }

        /** 
         * Binds functions to topics
         */ 
        _bindFunctions (settings) {
            let _this = this;

            for (var i in settings) {
                var functionArn = settings[i].deployed.Arn;
                functionArn = functionArn.split(':');
                functionArn.pop();
                functionArn = functionArn.join(':');
                var sns = _this._getTopicNameBySettings(settings[i]);

                console.log('binding function ' + settings[i].deployed.function + ' to topic ' + sns);
                _this.sns.subscribeAsync({
                    'Protocol': 'lambda',
                    'TopicArn': _this._getTopicArnByFunctionArn(functionArn, sns),
                    'Endpoint': functionArn,
                })
                .then(function(result){
                    console.log('done');
                    // console.log('result', result);
                });
            }
        }

        /** 
         * returns the topic that needs to be created replaces keys
         *
         * @param object settings
         *
         * @return string
         */
        _getTopicNameBySettings (settings) {
            var replacements = [];
            replacements['project'] = this.S.state.meta.variables.project;
            replacements['stage'] = this.stage;
            replacements['component'] = settings.deployed.component;
            replacements['module'] = settings.deployed.module;
            replacements['function']= settings.deployed.function;

            var topic = settings.sns.topic;
            for (var i in replacements) {
                topic = topic.replace('${' + i + '}', replacements[i]);
            }

            return topic;
        }

        _getTopicArnByFunctionArn(functionArn, topicName){
            var start = functionArn.split(':function:');
            var topicArn = start[0] + ':' + topicName;

            topicArn = topicArn.replace(':lambda:', ':sns:');
            return topicArn;
        }

        /**
         * collects the topics and calls create topcs
         *
         * @param array settings
         *
         * @return BpPromise
         */
        _manageTopics(settings) {
            var _this = this;

            var topics = [];
            for (var i in settings) {
                var topic = _this._getTopicNameBySettings(settings[i]);
                topics[topic] = topic;
            }

            return _this._createTopics(topics);
        }

        /**
         * creates topics if not yet done
         *
         * @param array topics
         *
         * @return BpPromise
         */
        _createTopics (topics) {
            var _this = this;
            _this.topics = topics;

            return _this.sns.listTopicsAsync()
            .then(function(topicListResult){
                var _this = this;
                //create fast checkable topiclist['topic1'] = 'topic1'
                var topicList = [];
                if (topicListResult['Topics']) {
                    for (var i in topicListResult.Topics) {
                        var arnParts = topicListResult.Topics[i].TopicArn.split(':')
                        var topicName = arnParts[arnParts.length - 1];
                        topicList[topicName] = topicName;
                    }
                }

                var topicCreatePromises = [];
                
                for (var i in this.topics) {
                    if (!topicList[i]) {
                        console.log('topic ' + i + ' does not exist. it will be created now');
                        topicCreatePromises.push(
                            _this.sns.createTopicAsync({
                                'Name': i
                            })
                            .then(function(){
                                console.log('topic created');
                            })
                            .catch(function(e){
                                console.log('error during creation of the topic !', e)
                            })
                        );
                    } else {
                        console.log('topic ' + i + ' exists.');
                    }
                }

                if (topicCreatePromises.length > 0) {
                    return BbPromise.all(topicCreatePromises);
                } else {
                    return new BbPromise(function(resolve, reject) {
                        return resolve(evt);
                    });                    
                }
            }.bind(this));
        }

        /**
         * initializes aws
         *
         * @param string region
         *
         * @return void
         */
        _initAws (region) {
            let _this = this;

            _this.sns = new AWS.SNS({
                region: region,
                accessKeyId: this.S.config.awsAdminKeyId,
                secretAccessKey: this.S.config.awsAdminSecretKey
            });

            BbPromise.promisifyAll(_this.sns);
        }


        /**
         * parses the sns-function.json file and returns the data
         *
         * @param object evt
         * @param string region
         *
         * @return array
         */
        _getFunctionsSNSSettings(evt, region){
            let _this = this;
            var settings = [];
            for (var deployedIndex in evt.data.deployed[region]) {
                let deployed = evt.data.deployed[region][deployedIndex],
                    settingsFile = _this.S.config.projectPath + '/' + deployed.component + '/' + deployed.module + '/' + deployed.function + '/s-function.json';

                if (!fs.existsSync(settingsFile)) {
                    continue;
                }

                try {
                    var config = JSON.parse(fs.readFileSync(settingsFile));

                    if (!config.sns) {
                        continue;
                    }

                    settings.push({
                        "deployed": deployed,
                        "sns": config.sns
                    });
                } catch (e) {
                    console.log('alerting.json not readable');
                    continue;
                }            
            }

            return settings;
        }
    }

    return ServerlessPluginSNS;
};
