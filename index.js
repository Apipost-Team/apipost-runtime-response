const grpc = require('apipost-grpc'),
  socketIO = require('socket.io'),
  fs = require('fs'),
  CryptoJS = require('crypto-js'),
  ASideTools = require('apipost-inside-tools'),
  _ = require('lodash'),
  uuid = require('uuid'),
  dayjs = require('dayjs'),
  path = require('path'),
  buffersSchema = require('protocol-buffers-schema'),
  SocketClient = require('socket-client-apipost'),
  { Collection, Runtime } = require('apipost-runtime'),
  { Dubbo, java, setting } = require('apache-dubbo-js/es7'),
  socketClient = new SocketClient();

// global vars
const RUNNER_REPORT_IDS = {};
const RUNNER_RUNTIME = {};
const RUNNER_RUNTIME_SCENES = {};

// global function
const getCachePath = function () {
  return ASideTools.getCachePath();
};

// 创建proto文件
const createProtoFiles = function (proto, name = '') {
  try {
    let _path = '';

    if (_.isString(proto)) {
      let buffers = buffersSchema.parse(proto);

      if (_.isObject(buffers) && _.isArray(buffers.messages) && buffers.messages.length > 0) {
        if (name == '') {
          _path = path.join(path.resolve(getCachePath()), `${CryptoJS.MD5(proto).toString()}.proto`);
        } else {
          _path = path.join(path.resolve(getCachePath()), name);
        }

        try {
          fs.mkdirSync(path.dirname(_path), { recursive: true });
          fs.writeFileSync(_path, proto);
          return _path;
        } catch (e) {
          return false;
        }
        // if (fs.existsSync(_path) && 0) { /// && name == ''
        //   return _path;
        // } else {

        // }
      } else {
        return false;
      }
    } else {
      return false;
    }
  } catch (e) {
    return false;
  }
}

// 结果转换函数
const ConvertResult = function (status, message, data) {
  return ASideTools.ConvertResult(status, message, data);
};

// dubbo 参数序列化转换
const handleDubboParams = function (params) {
  let _params = [...params];

  _params = _params.map((item) => {
    if (item?.children.length <= 0) {
      return java.combine(item.field_type, item.value)
    }

    return handleDubboChildrenParams(item)
  });

  return _params;
};

const handleDubboChildrenParams = function (childrenParam) {
  const value = childrenParam?.children?.reduce((acc, curr) => {
    // 参数没有选中，不进行转换
    if (curr?.is_checked === -1) {
      return acc;
    }

    if (curr?.children?.length <= 0) {
      if (curr.key && curr.field_type) {
        acc[curr.key] = java.combine(curr.field_type, curr.value);
      }
    } else {
      acc[curr.key] = handleDubboChildrenParams(curr);
    }

    return acc;
  }, {});

  return java.combine(childrenParam.field_type, value)
}

async function runtimeResponse(icpEvent, arg, workerIcp) {
  if (!_.isObject(icpEvent) && typeof workerIcp == 'object') {
    icpEvent = workerIcp
  }

  try {
    if (_.isObject(arg)) {
      var { runtime_id, action, chunk } = arg;
      switch (action) {
        case 'stop':
          if (_.isObject(RUNNER_RUNTIME[runtime_id]) && _.isFunction(RUNNER_RUNTIME[runtime_id].stop) && RUNNER_REPORT_IDS[runtime_id]) {
            RUNNER_RUNTIME[runtime_id].stop(RUNNER_REPORT_IDS[runtime_id], '用户强制停止');
            delete RUNNER_REPORT_IDS[runtime_id];

            icpEvent.sender.send('stop_response', { runtime_id, status: 'SUCCESS' });
          }
          break;
        case 'socket':
          const { ConnectAndSendMessage } = require('apipost-socket-client');
          icpEvent.sender.send(`socket_response`, await ConnectAndSendMessage(chunk));
          break;
        case 'runner':
          var { test_events, option } = chunk;

          let _scene = typeof option === 'object' ? option.scene : 'auto_test';


          if (_.isUndefined(_scene)) {
            _scene = 'auto_test';
          }

          // 发送 RuntimeEvent 消息函数
          const emitRuntimeEvent = function (msg) {
            if (msg?.action == 'console' && msg?.method == 'log' && _.has(msg, 'message.data')) { // fix bug
              msg.message.data = JSON.stringify(msg.message.data);
            }

            if (_scene == 'auto_test') {
              icpEvent.sender.send('auto_test_response', ConvertResult('success', 'success', _.cloneDeep(msg)));
            } else {
              icpEvent.sender.send('runtime_response', ConvertResult('success', 'success', _.cloneDeep(msg)));
            }
          };



          if (option.iterationCount <= 0) {
            option.iterationCount = 1;
          }

          // fix bug
          if (RUNNER_RUNTIME_SCENES[runtime_id] && RUNNER_RUNTIME_SCENES[runtime_id] == 'auto_test' && _scene == 'auto_test') {
            // if (RUNNER_RUNTIME_SCENES[runtime_id] == 'auto_test' && _scene == 'auto_test') {
            icpEvent.sender.send('runner_response', { //todo
              runtime_id,
              status: 'ERROR',
              message: `当前正在执行任务 ${RUNNER_REPORT_IDS[runtime_id]}, 请结束后再执行其他任务`,
            });
            // }
          } else {
            const myCollection = new Collection(test_events, { iterationCount: option.iterationCount, sleep: option.sleep });
            RUNNER_RUNTIME_SCENES[runtime_id] = _scene;
            RUNNER_RUNTIME[runtime_id] = new Runtime(emitRuntimeEvent);
            RUNNER_REPORT_IDS[runtime_id] = uuid.v4();


            // //fix bug url带中有中文处理
            // if(_.isArray(option?.collection)){
            //   option?.collection.forEach((item,itemIndex)=>{
            //     if(_.isString(item?.request.url)){
            //       const encodeURIStr=encodeURI(item.request.url);
            //       _.set(option,'collection['+itemIndex+'].request.url',encodeURIStr);
            //     }
            //   })
            // }
            //console.log(myCollection.definition,'rutime inner data.definition--------');
            _.set(option, 'RUNNER_REPORT_ID', RUNNER_REPORT_IDS[runtime_id]);
            await RUNNER_RUNTIME[runtime_id].run(myCollection.definition, option);

            delete RUNNER_REPORT_IDS[runtime_id];
            delete RUNNER_RUNTIME[runtime_id];
            delete RUNNER_RUNTIME_SCENES[runtime_id];
          }
          break;
        case 'grpc':
          var { option, data, target_id } = chunk;
          var { func, target } = data;
          var callFunc = {};
          var gRpcClient = {};

          new Array('serverList', 'allMethodList', 'methodList', 'mockMethodRequest', 'request').forEach((func) => {
            callFunc[func] = function () {
              switch (func) {
                case 'serverList':
                  gRpcClient = new grpc(option);
                  icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('success', 'success', {
                    target_id,
                    response: gRpcClient.serverList(),
                  }));
                  break;
                case 'allMethodList':
                  gRpcClient = new grpc(option);
                  let _response = gRpcClient.allMethodList();

                  if (_.isString(_response?.err)) {
                    icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('error', _response?.err, { target_id }));
                  } else {
                    icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('success', 'success', {
                      target_id,
                      response: _response,
                    }));
                  }

                  break;
                case 'methodList':
                  gRpcClient = new grpc(option);
                  icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('success', 'success', {
                    target_id,
                    response: gRpcClient.methodList(target.service),
                  }));
                  break;
                case 'mockMethodRequest':
                  console.log(option, 'optionoptionoption')
                  gRpcClient = new grpc(option);
                  icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('success', 'success', {
                    target_id,
                    response: gRpcClient.mockMethodRequest(target.service, target.method),
                  }));
                  break;
                case 'request':
                  gRpcClient = new grpc(option);
                  gRpcClient.request(target.service, target.method, target).then((data) => {
                    icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('success', 'success', {
                      target_id,
                      response: data.data,
                    }));
                  }).catch((err) => {
                    icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('error', err.message.toString(), {
                      target_id,
                      response: data.data,
                    }));
                  });
                  break;
              }
            };
          });

          try {
            if (option.proto.substr(0, 7) === 'http://' || option.proto.substr(0, 8) === 'https://') {
              request.get(option.proto, (err, res) => {
                if (!err) {
                  option.proto = path.join(path.resolve(getCachePath()), `${CryptoJS.MD5(res.rawBody).toString()}.proto`);

                  if (fs.existsSync(option.proto)) {
                    if (_.isFunction(callFunc[func])) {
                      callFunc[func]();
                    }
                  } else {
                    fs.writeFile(option.proto, res.body, (err) => {
                      if (err) {
                        icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('error', err.toString(), { target_id }));
                      } else if (_.isFunction(callFunc[func])) {
                        callFunc[func]();
                      }
                    });
                  }
                } else {
                  icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('error', err.toString(), { target_id }));
                }
              });
            } else if (fs.existsSync(option.proto)) {
              if (_.isFunction(callFunc[func])) {
                callFunc[func]();
              }
            } else {
              let _proto_file = createProtoFiles(option.proto);

              if (_proto_file) {
                _.assign(option, {
                  proto: _proto_file
                });

                if (_.isArray(option?.includeFiles)) {
                  let _includeDirs = [];
                  _.forEach(option.includeFiles, function (item) {
                    if (_.isString(item.path) && !fs.existsSync(item.proto) && _.isString(item.proto)) {
                      let _includeFile = createProtoFiles(item.proto, item.path);

                      if (_includeFile) {
                        _includeDirs.push(path.resolve(path.dirname(_includeFile)));
                      }
                    }
                  });

                  _.set(option, "includeDirs", _.union(option?.includeDirs, _includeDirs));
                }

                if (_.isFunction(callFunc[func])) {
                  callFunc[func]();
                }

              } else {
                icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('error', 'proto文件初始化创建失败' + _proto_file, { target_id }));
              }
            }
          } catch (err) {
            if (typeof func != 'undefined' && typeof target_id == 'string') {
              icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('error', `error3: ${err.toString()}`, { target_id }));
            }
          }
          break;
        case 'dubbo':
          var { data } = chunk;
          var { target_id } = data;
          var { url, apiRunName, funName, version = '', group = '', appName = '', query = [] } = data.request || {};

          try {
            const dubboSetting = setting.match(
              apiRunName,
              { version }
            )
            // 创建dubbo对象
            const dubbo = new Dubbo({
              application: { name: appName },
              register: url, // zookeeper address
              dubboVersion: '3.0.0',
              interfaces: [apiRunName],
              group,
              dubboSetting
            });

            // 代理本地对象->dubbo对象
            const dubboProxyService = dubbo.proxyService({
              dubboInterface: apiRunName,
              version,
              group,
              methods: {
                [funName](params) {
                  const finalParams = handleDubboParams(params);
                  // 仅仅做参数hessian化转换
                  return finalParams;
                },
              },
            });

            const response = await dubboProxyService[funName](query.parameter);

            if (response.err) {
              icpEvent.sender.send(
                'dubbo_response',
                ConvertResult(
                  'error',
                  String(response.err),
                  { target_id, response: { ...response, err: String(response.err) } }
                )
              );
              return;
            };
            icpEvent.sender.send(
              'dubbo_response',
              ConvertResult(
                'success',
                'success',
                { target_id, response }
              )
            );
          } catch (error) {
            icpEvent.sender.send(
              'dubbo_response',
              ConvertResult('error', String(error), { err: String(error) })
            );
          }
          break;
        case 'websocket':
          var { action, target, message, event } = chunk;
          var { target_id } = target || {};
          switch (action) {
            case 'connect':
              try {
                socketClient.connect(target);
              } catch (error) {
                icpEvent.sender.send('websocket_res', {
                  id: target_id,
                  action: 'error',
                  data: Object.prototype.toString.call(error) === '[object Object]' ? JSON.stringify(error) : String(error),
                  time: dayjs(new Date().getTime()).format('HH:mm:ss'),
                });
              }

              socketClient.onconnect(target_id, (data) => {
                // console.log('成功连接啦', data);
                icpEvent.sender.send('websocket_res', {
                  id: target_id,
                  action: 'connect',
                  time: dayjs(new Date().getTime()).format('HH:mm:ss'),
                });
              });
              socketClient.onclose(target_id, (data) => {
                // console.log('断开连接', data);
                icpEvent.sender.send('websocket_res', {
                  id: target_id,
                  action: 'disconnect',
                  time: dayjs(new Date().getTime()).format('HH:mm:ss'),
                });
              });
              socketClient.onmessage(target_id, (data) => {
                // console.log('接收消息', JSON.stringify(data), String(data));
                icpEvent.sender.send('websocket_res', {
                  id: target_id,
                  action: 'message',
                  data: Object.prototype.toString.call(data) === '[object Object]' ? JSON.stringify(data) : String(data),
                  time: dayjs(new Date().getTime()).format('HH:mm:ss'),
                });
              }, event);
              socketClient.onerror(target_id, (data) => {
                // console.log('发送异常', JSON.stringify(data.message), String(data));
                icpEvent.sender.send('websocket_res', {
                  id: target_id,
                  action: 'error',
                  data: Object.prototype.toString.call(data) === '[object Object]' ? JSON.stringify(data) : String(data),
                  time: dayjs(new Date().getTime()).format('HH:mm:ss'),
                });
              });
              break;
            case 'disconnect':
              socketClient.close(target_id);
              break;
            case 'message':
              if (event) {
                socketClient.send(target_id, message, event);
              } else {
                socketClient.send(target_id, message);
              }
              break;
            case 'closeAll':
              socketClient.closeAll();
              break;
            default:
              break;
          }
          break;
      }
    }
  } catch (err) {
    const runnerType = arg?.action;
    if (runnerType === 'runner') {
      let target_id = '-1';
      if (_.isObject(arg)) {
        target_id = arg?.chunk?.option?.collection[0]?.target_id;
      }
      icpEvent.sender.send('runtime_response', ConvertResult('error', String(err), {
        target_id
      }));
    } else {
      icpEvent.sender.send('runtime_response', ConvertResult('error', String(err)));
    }
    console.error(err);
  }
}

module.exports = runtimeResponse;
module.exports.runtimeResponse = runtimeResponse;