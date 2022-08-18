<p align="center">
  <a href="https://adesign.apipost.cn/" target="_blank">
    <img alt="A-Design Logo" width="360" src="https://img.cdn.apipost.cn/cdn/opensource/apipost-opensource.svg" />
  </a>
</p>

# 🚀 apipost-runtime-response
A module for apipost runtime.
## Install

```
$ npm install apipost-runtime-response
```

##  Usage
### render
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
