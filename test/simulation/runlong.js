var mc = require('../../lib/memcache-client');

var count = 0;
var max   = 100000;
var defer = 60000;

var cli = new mc.Client();
cli.connect(function() {
  spray_server();
});

function log(cmd, output) {
  console.log("(" + count + ") " + cmd + ": " + output);
  count++;
}

function set(iter) {
  cli.set('K' + iter, iter, function(err, response) {
    if (err) { log("SET",err.type ); } 
    else     { log("SET",response); }
  });
}

function add(iter) {
  cli.add('K' + iter, iter, function(err, response) {
    if (err) { log("ADD",err.type ); } 
    else     { log("ADD",response); }
  });
}

function replace(iter) {
  cli.replace('K' + iter, iter, function(err, response) {
    if (err) { log("REPL",err.type ); } 
    else     { log("REPL",response); }
  });
}

function del(iter) {
  cli.del('K' + iter, function(err, response) {
    if (err) { log("DEL",err.type ); } 
    else     { log("DEL",response); }
  });
}

function get(iter) {
  var iteration = iter;
  cli.get('K' + iter, function(err, response) {
    if (err) { log("GET",err.type ); } 
    else     {
      if (iteration != response.val) {
	log("GET", "*********************** " + iteration + ":" + response.val);
      } else {	  
	log("GET", "OK: " + response.val); }
      }
  });
}

function run(i, call) {
  var delay = Math.floor(Math.random() * defer);
  setTimeout(function() { call(i); } , delay);
}

function spray_server() {
  for (var i = 0; i <= max; i++) {
    var call = Math.floor(Math.random() * 5);
    switch (call) {
    case 0:
      run(i, get);
      break;
    case 1:
      run(i, set);
      break;
    case 2: 
      run(i, add);
      break;
    case 3:
      run(i, replace);
      break;
    case 4:
      run(i, del);
      break;
    default:
      console.log("Whaaa?");
    }
  }
}

var t = setInterval(function() {
  if (count >= max) {
    console.log("Done.");
    clearInterval(t);
    cli.close();
  }
}, 1000);