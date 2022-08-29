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
  socketClient = new SocketClient();

// global vars
const RUNNER_REPORT_IDS = {};
const RUNNER_RUNTIME = {};
const RUNNER_RUNTIME_SCENES = {};

// global function
const getCachePath = function () {
  return ASideTools.getCachePath();
};

// 结果转换函数
const ConvertResult = function (status, message, data) {
  return ASideTools.ConvertResult(status, message, data);
};

async function runtimeResponse(icpEvent, arg) {
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
        case 'runner':
          // 发送 RuntimeEvent 消息函数
          const emitRuntimeEvent = function (msg) {
            icpEvent.sender.send('runtime_response', ConvertResult('success', 'success', msg));
          };

          var { test_events, option } = chunk;

          if (option.iterationCount <= 0) {
            option.iterationCount = 1;
          }

          let _scene = typeof option === 'object' ? option.scene : 'auto_test';
          if (_.isUndefined(_scene)) {
            _scene = 'auto_test';
          }

          if (RUNNER_RUNTIME_SCENES[runtime_id]) {
            if (RUNNER_RUNTIME_SCENES[runtime_id] == 'auto_test' && _scene == 'auto_test') {
              icpEvent.sender.send('runner_response', {
                runtime_id,
                status: 'ERROR',
                message: `当前正在执行任务 ${RUNNER_REPORT_IDS[runtime_id]}, 请结束后再执行其他任务`,
              });
            }
          } else {
            const myCollection = new Collection(test_events, { iterationCount: option.iterationCount });
            RUNNER_RUNTIME_SCENES[runtime_id] = _scene;
            RUNNER_RUNTIME[runtime_id] = new Runtime(emitRuntimeEvent);
            RUNNER_REPORT_IDS[runtime_id] = uuid.v4();

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
                  icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('success', 'success', {
                    target_id,
                    response: gRpcClient.allMethodList(),
                  }));
                  break;
                case 'methodList':
                  gRpcClient = new grpc(option);
                  icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('success', 'success', {
                    target_id,
                    response: gRpcClient.methodList(target.service),
                  }));
                  break;
                case 'mockMethodRequest':
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
              try {
                const buffers = buffersSchema.parse(option.proto);

                if (_.isObject(buffers) && _.isArray(buffers.messages) && buffers.messages.length > 0) {
                  const proto = path.join(path.resolve(getCachePath()), `${CryptoJS.MD5(option.proto).toString()}.proto`);

                  if (fs.existsSync(proto)) {
                    option.proto = proto;
                    if (_.isFunction(callFunc[func])) {
                      callFunc[func]();
                    }
                  } else {
                    fs.writeFile(proto, option.proto, (err) => {
                      if (err) {
                        icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('error', `error1: ${err.toString()}`, { target_id }));
                      } else {
                        option.proto = proto;

                        if (_.isFunction(callFunc[func])) {
                          callFunc[func]();
                        }
                      }
                    });
                  }
                } else {
                  icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('error', '对应的proto文件不存在', { target_id }));
                }
              } catch (err) {
                icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('error', `error2: ${err.toString()}`, { target_id }));
              }
            }
          } catch (err) {
            icpEvent.sender.send(`grpc_${func}_response`, ConvertResult('error', `error3: ${err.toString()}`, { target_id }));
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
    console.error(err);
    icpEvent.sender.send('runtime_response', ConvertResult('error', String(err)));
  }
}

module.exports = runtimeResponse;
module.exports.runtimeResponse = runtimeResponse;
