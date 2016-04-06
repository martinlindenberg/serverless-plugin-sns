Serverless Plugin SNS
=====================

[![NPM](https://nodei.co/npm/serverless-plugin-sns.png?downloads=true)](https://nodei.co/npm/serverless-plugin-sns/)

This plugin easily subscribes your lambda functions to SNS notifications.

*Note*: This plugin supports Serverless 0.5.* (please see previous versions for older sls versions)


### Installation

 - make sure that aws and serverless are installed
 - @see http://docs.aws.amazon.com/cli/latest/userguide/installing.html
 - @see http://www.serverless.com/

 - install this plugin to your projects node_modules folder

```
cd projectfolder
npm install serverless-plugin-sns
```

 - add the plugin to your s-project.json file

```
"plugins": [
    "serverless-plugin-sns"
]
```

### Run the Plugin

 - the plugin uses a hook that is called after each deployment of a function 
 - you only have to deploy your function as usual `sls function deploy`
 - add the following attribute to the s-function.json in your functions folder

```
  ...
  "sns": {
    "topic": "your-dev-sns-topic"
  },
  ...
```

 - the topic will be created automatically, if not yet done
 - topicnames can use the following dynamic template-names:

```
${project}
${stage}
${functionName}

example:
  "sns": {
    "topic": "${project}-sns"
  },
```

### Next Steps

 - create notifications that push events to sns topics
 - for example: cloudwatch alerts can submit notifications to sns topics 
 - @see https://github.com/martinlindenberg/serverless-plugin-alerting :)
