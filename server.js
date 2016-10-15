var express = require('express');
var app = express();
var server = require('http').Server(app);
var passport = require('passport')
var LocalStrategy = require('passport-local').Strategy;
var r = require('rethinkdb');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var io = require('socket.io')(server);
var passportSocketIo = require('passport.socketio');
var RDBStore = require('express-session-rethinkdb')(session);

var rdbStore = new RDBStore({
  connectOptions: {
    servers: [
      { host: '127.0.0.1', port: 28015 }
    ],
    db: 'db',
    discovery: false,
    pool: true,
    buffer: 50,
    max: 1000,
    timeout: 20,
    timeoutError: 1000
  },
  table: 'session',
  sessionTimeout: 86400000,
  flushInterval: 60000,
  debug: false
});

app.use(express.static('public'));
app.use(cookieParser());
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

app.use(session({
    store: rdbStore,
    secret: 'keyboard cat',
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days
    saveUninitialized: true,
    resave: true
}));

app.use(passport.initialize());
app.use(passport.session());

var rethinkdb = {
	host: 'localhost',
	port: 28015,
	authKey: '',
	db: 'db'
};

function onConnect(callback) {
  r.connect({host: rethinkdb.host, port: rethinkdb.port }, function(err, connection) {
    connection['_id'] = Math.floor(Math.random()*10001);
    callback(err, connection);
  });
}

io.use(passportSocketIo.authorize({
  key: 'connect.sid',
  secret: 'keyboard cat',
  store: rdbStore,
  passport: passport,
  cookieParser: cookieParser
}));

// passport ====================================================================

passport.use(new LocalStrategy(
  function(username, password, done) {
	
	onConnect(function (err, connection) {
		r.db(rethinkdb.db).table('users').filter({ username: username }).limit(1).run(connection, function(err, cursor) {
			if (err) { return done(err); }
			cursor.toArray(function(err, result) {
				if (err) { return done(err); }
				if (!result) {
					return done(null, false);
				}
				if (result[0].password != password) {
					return done(null, false);
				}
				return done(null, result[0]);
			});
			connection.close();
		  });
	});
	
  }
));

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
	onConnect(function (err, connection) {
		r.db(rethinkdb.db).table('users').filter({ id: id }).limit(1).run(connection, function(err, cursor) {

			cursor.toArray(function(err, result) {
				return done(err, result[0]);
			});
			connection.close();
		  });
	});
});

app.get('/', function (req, res) {
	if (req.user == null) {
		res.render('index', { logged: false });
	} else {
		res.render('index', { logged: true, username: req.user.username });
	}
});

app.get('/error', function (req, res) {
	res.send("Error, not authenticated");
});

app.post('/', passport.authenticate('local', { successRedirect: '/', failureRedirect: '/error' }));

var eventSocket = io.of('/');
eventSocket.on('connection', function(socket) {

  socket.emit('hello', 'How are you?');
  socket.on('hello_back', function(data) {
	//Get the data from express session
	if (socket.request.user && socket.request.user.logged_in) {
		console.log(socket.request.user);
	}
  });
});

server.listen(3000, function () {
	console.log('Server started on port 3000');
});