require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 5000;

const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wqymk7z.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  next();
};

const verifyTokenEmail = async (req, res, next) => {
  const email = req.query.email;
  if (email !== req.decoded.email) {
    return res.status(401).send({ message: "Forbidden access" });
  }
  next();
};

async function run() {
  try {
    const db = client.db("education");
    const courseCollection = db.collection("courses");
    const userCollection = db.collection("users");
    const enrollmentCollection = db.collection("enroll");

    app.get("/rrr", async (req, res) => {
      return res.send("eeeeeeeeeeee");
    });

    // users api
    app.post("/api/users", async (req, res) => {
      const { email, displayName, photoURL, creationTime, lastSignInTime } =
        req.body;

      if (!email) {
        return res
          .status(400)
          .send({ error: true, message: "Email is required" });
      }

      const existingUser = await userCollection.findOne({ email });

      if (existingUser) {
        return res.status(200).send({ status: "existing", user: existingUser });
      }

      const result = await userCollection.insertOne({
        email,
        displayName,
        photoURL,
        creationTime,
        lastSignInTime,
      });

      res.status(201).send({ status: "new", insertedId: result.insertedId });
    });

    app.get("/api/courses", async (req, res) => {
      const { filter, limit } = req.query;
      const limitNumber = parseInt(limit) || 0;

      if (filter === "popular") {
        const popularCourseIds = await enrollmentCollection
          .aggregate([
            {
              $group: {
                _id: "$courseId",
                enrollCount: { $sum: 1 },
              },
            },
            { $sort: { enrollCount: -1 } },
            { $limit: limitNumber },
          ])
          .toArray();

        const courseIds = popularCourseIds.map((item) => item._id);

        const courses = await courseCollection
          .find({
            _id: { $in: courseIds.map((id) => new ObjectId(id)) },
          })
          .toArray();

        const sortedCourses = courseIds.map((id) =>
          courses.find((course) => course._id.toString() === id)
        );

        res.send(sortedCourses);
      } else if (filter === "recent") {
        const courses = await courseCollection
          .find({})
          .sort({ createdAt: -1 })
          .limit(limitNumber)
          .toArray();
        res.send(courses);
      } else {
        const courses = await courseCollection
          .find({})
          .limit(limitNumber)
          .toArray();
        res.send(courses);
      }
    });

    // courses api
    app.post("/api/courses", async (req, res) => {
      const data = req.body;
      const result = await courseCollection.insertOne(data);
      res.send(result);
    });

    app.get("/api/courses/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const pipeline = [
          {
            $match: {
              _id: new ObjectId(id),
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "authorEmail",
              foreignField: "email",
              as: "authorInfo",
            },
          },
          {
            $unwind: "$authorInfo",
          },
          {
            $project: {
              title: 1,
              price: 1,
              duration: 1,
              totalVideos: 1,
              totalLessons: 1,
              category: 1,
              level: 1,
              accessType: 1,
              description: 1,
              seats: 1,
              image: 1,
              createdAt: 1,
              authorEmail: 1,
              "authorInfo.displayName": 1,
              "authorInfo.photoURL": 1,
            },
          },
        ];

        const result = await courseCollection.aggregate(pipeline).toArray();
        if (result.length > 0) {
          res.send(result[0]);
        } else {
          res.status(404).send({ error: true, message: "Course not found" });
        }
      } catch (error) {
        res.status(500).send({
          error: true,
          message: "Server error",
          details: error.message,
        });
      }
    });

    app.get(
      "/api/my-courses",
      verifyFirebaseToken,
      verifyTokenEmail,
      async (req, res) => {
        const { filter, email } = req.query;

        let query = { authorEmail: email };
        let sortOption = {};

        if (filter === "recent") {
          sortOption = { createdAt: -1 };
        }

        const courses = await courseCollection
          .find(query)
          .sort(sortOption)
          .toArray();
        res.send(courses);
      }
    );

    // Update course
    app.get(
      "/api/edit-course/:id",
      verifyFirebaseToken,
      verifyTokenEmail,
      async (req, res) => {
        const id = req.params.id;
        const email = req.query.email;

        const course = await courseCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!course || course.authorEmail !== email) {
          return res
            .status(403)
            .send({ error: true, message: "Access denied" });
        }
        res.send(course);
      }
    );

    app.patch(
      "/api/edit-course/:id",
      verifyFirebaseToken,
      verifyTokenEmail,
      async (req, res) => {
        const id = req.params.id;
        const update = req.body;
        const filter = {
          _id: new ObjectId(id),
          authorEmail: req.decoded.email,
        };

        const result = await courseCollection.updateOne(filter, {
          $set: update,
        });

        if (result.modifiedCount === 0) {
          return res
            .status(403)
            .send({ error: true, message: "Unauthorized or no Change" });
        }

        res.send(result);
      }
    );

    // delete course
    app.delete(
      "/api/delete-course/:id",
      verifyFirebaseToken,
      verifyTokenEmail,
      async (req, res) => {
        const id = req.params.id;
        const email = req.query.email;

        const course = await courseCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!course || course.authorEmail !== email) {
          return res
            .status(403)
            .send({ error: true, message: "Access denied." });
        }

        const result = await courseCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    // course enrol
    app.post("/api/enroll", verifyFirebaseToken, async (req, res) => {
      const { email, courseId } = req.body;

      if (!email || !courseId) {
        return res.status(400).send({ error: true, message: "Missing fields" });
      }

      const course = await courseCollection.findOne({
        _id: new ObjectId(courseId),
      });
      if (!course) {
        return res
          .status(404)
          .send({ error: true, message: "course not found" });
      }

      if (course.authorEmail === email) {
        return res.status(403).send({
          error: true,
          message: "You cannot enroll in your own course.",
        });
      }

      const existing = await enrollmentCollection.findOne({ courseId, email });

      if (existing) {
        await enrollmentCollection.deleteOne({ _id: existing._id });
        await courseCollection.updateOne(
          { _id: new ObjectId(courseId) },
          { $inc: { seats: 1 } }
        );
        const updated = await courseCollection.findOne({
          _id: new ObjectId(courseId),
        });
        return res.send({
          success: true,
          message: "Unenrolled successfully",
          enrolled: false,
          seatsLeft: updated.seats,
        });
      }

      const count = await enrollmentCollection.countDocuments({ email });
      if (count >= 3) {
        return res.status(403).send({
          error: true,
          message: "You can Enroll in only 3 Courses at a time",
        });
      }

      if (course.seats <= 0) {
        return res.status(403).send({ error: true, message: "No seats left" });
      }

      await enrollmentCollection.insertOne({
        email,
        courseId,
        enrolledAt: new Date(),
      });
      await courseCollection.updateOne(
        { _id: new ObjectId(courseId) },
        { $inc: { seats: -1 } }
      );
      const updated = await courseCollection.findOne({
        _id: new ObjectId(courseId),
      });

      res.send({
        success: true,
        message: "Enrolled successfully",
        enrolled: true,
        seatsLeft: updated.seats,
      });
    });

    app.get("/api/is-enrolled", verifyFirebaseToken, async (req, res) => {
      const { courseId } = req.query;
      const email = req.decoded.email;

      const existing = await enrollmentCollection.findOne({ courseId, email });
      res.send({ enrolled: !!existing });
    });

    app.get(
      "/api/my-enrollments",
      verifyFirebaseToken,
      verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;

        try {
          const enrollments = await enrollmentCollection
            .find({ email })
            .toArray();

          const courseIds = enrollments.map((e) => new ObjectId(e.courseId));

          const courses = await courseCollection
            .find({ _id: { $in: courseIds } })
            .project({ title: 1, image: 1, price: 1, level: 1, description: 1 })
            .toArray();

          res.send({ success: true, data: courses });
        } catch (err) {
          console.error(err);
          res.status(500).send({
            success: false,
            message: "Failed to load enrolled courses",
          });
        }
      }
    );
    // await client.db("admin").command({ ping: 1 });
    console.log("✅ Successfully connected to MongoDB!");
  } catch (error) {
    console.error("❌ Error Connecting to MongoDB:", error);
  }
}
run().catch(console.dir);

// Basic route
app.get("/", (req, res) => {
  res.send("🚀 Education Server is running...");
});

// Start server
app.listen(port, () => {
  console.log(`✅ Server is running on port ${port}`);
});
