const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);



const app = express();
const port = process.env.PORT || 5000;

//Middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.n6iyx.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

//Verify JWT
function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: "Unauthorized Access" });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: "Forbidden Access" })
        }
        req.decoded = decoded;
        next();
    });
};



async function run() {
    try {
        await client.connect();
        const serviceCollection = client.db("doctors_portal").collection("services");
        const reviewCollection = client.db("doctors_portal").collection("reviews");
        const bookingCollection = client.db("doctors_portal").collection("bookings");
        const userCollection = client.db("doctors_portal").collection("users");
        const doctorsCollection = client.db("doctors_portal").collection("doctors");
        const paymentsCollection = client.db("doctors_portal").collection("payments");


        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email;
            const requeserAccount = await userCollection.findOne({ email: requester });
            if (requeserAccount.role === "admin") {
                next();
            } else {
                return res.status(403).send({ message: "Forbidden Access" });
            }
        };

        //Post Payment Intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body;
            const price = service.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            });
            res.send({ clientSecret: paymentIntent.client_secret });

        });

        //GET SERVICES
        app.get('/service', async (req, res) => {
            const query = {};
            const cursor = serviceCollection.find(query);
            const services = await cursor.toArray();
            res.send(services);
        });



        //Get Reviews
        app.get('/review', verifyJWT, async (req, res) => {
            const query = {};
            const cursor = reviewCollection.find(query);
            const reviews = await cursor.toArray();
            res.send(reviews);
        });
        
        //Post Review
        app.post('/review', verifyJWT, async (req, res) => {
            const review = req.body;
            const result = await reviewCollection.insertOne(review);
            res.send(result);
        });




        //Get Admin
        app.get('/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email });
            const isAdmin = user.role === "admin";
            res.send({ admin: isAdmin });
        });

        //PUT Admin COLLECTION
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: "admin" },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        });




        //Get ALL Users
        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users);
        });

        //PUT USER COLLECTION
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user,
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ result, token });
        });

        //Delete User
        app.delete('/user/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const deleteUser = await userCollection.deleteOne(filter);
            res.send(deleteUser);
        });





        //This is not the proper way to query
        //after learning more about Mongodb.use aggregate lookup,pipeline,match,group.

        app.get('/available', async (req, res) => {
            const date = req.query.date || "May 15, 2022";

            //Step-1: get all the services
            const services = await serviceCollection.find().toArray();
            //Step-2: get booking of that day
            const query = { date: date };
            const bookings = await bookingCollection.find(query).toArray();
            //Step-3: forEach services ,find booking for that days
            services.forEach(service => {
                //step-4: find bookings for that service
                const serviceBookings = bookings.filter(book => book.treatment === service.name);
                //select slots for the service booking
                const bookedSlots = serviceBookings.map(book => book.slot);
                //select those slot what are not in booked slots
                const available = service.slots.filter(slot => !bookedSlots.includes(slot));
                service.slots = available;
            });
            res.send(services);
        });




        //GET BOOKING COLLECTIONS
        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient;
            const decodedEmail = req.decoded.email;
            if (patient === decodedEmail) {
                const query = { patient: patient };
                const bookings = await bookingCollection.find(query).toArray();
                return res.send(bookings);
            } else {
                return res.status(403).send({ message: "Forbidden Access" });
            }
        });

        //Get single booking for payment
        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking);
        });

        //POST BOOKING
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient };
            const exists = await bookingCollection.findOne(query);
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking);
            res.send({ success: true, result });
        });

        //Patch Booking
        app.patch('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            };
            const result = await paymentsCollection.insertOne(payment);
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);

            res.send(updatedDoc);
        });





        //POST Doctor
        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });

        //GET DOCTORS
        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorsCollection.find().toArray();
            res.send(doctors);
        });

        //Delete DOCTOR
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const deleteDoctors = await doctorsCollection.deleteOne(filter);
            res.send(deleteDoctors);
        });

    }
    finally {

    }
};

run().catch(console.dir);


//Default API
app.get('/', (req, res) => {
    res.send('Hello from Doctors portal!')
});

app.listen(port, () => {
    console.log(`Doctors portal listening on port ${port}`)
});


/**
         * API Naming Convention
         * app.get('/booking') //get all boking of this collection or get more than one or get by filter query.
         * app.get('/booking/:id') //get a specific booking.
         *  app.post('/booking/:id') // add a booking.
         *  app.patch('/booking/:id') //update a booking.
         *  app.put('/booking/:id') //Upsert=> update(if exist)+ insert(if doesn't exist)
         *  app.delete('/booking/:id') // delete a api.
         **/