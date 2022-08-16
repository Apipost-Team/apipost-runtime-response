# 🚀 apipost-runtime-response
A module for apipost runtime.
## Install

```
$ npm install apipost-runtime-response
```

##  Usage
### runder
```javascript
const {ipcRenderer} = require('electron');

$(function(){
ipcRenderer.on('runtime_response', function(event, arg){
    console.log(arg)
})

$(document).on('click', '.encode-btn', function(){
    ipcRenderer.send('runtime_request', {runtime_id:'123', action:'runner', chunk:_data});
    })
})
```
