#include <GLFW/glfw3.h>

#include <cmath>
#include <cstdio>

namespace {

struct CameraState {
    float x = 3200.0f;
    float y = 180.0f;
    float z = 3200.0f;
    float yaw = -90.0f;
    float pitch = -15.0f;
};

float clampf(float v, float lo, float hi) {
    return (v < lo) ? lo : ((v > hi) ? hi : v);
}

void moveForward(CameraState* cam, float amount) {
    const float yawRad = cam->yaw * 0.017453292519943295769f;
    cam->x += std::cos(yawRad) * amount;
    cam->z += std::sin(yawRad) * amount;
}

void moveRight(CameraState* cam, float amount) {
    const float yawRad = (cam->yaw + 90.0f) * 0.017453292519943295769f;
    cam->x += std::cos(yawRad) * amount;
    cam->z += std::sin(yawRad) * amount;
}

void updateCamera(GLFWwindow* window, CameraState* cam, float dt) {
    const float speed = (glfwGetKey(window, GLFW_KEY_LEFT_SHIFT) == GLFW_PRESS) ? 900.0f : 420.0f;
    const float step = speed * dt;

    if (glfwGetKey(window, GLFW_KEY_W) == GLFW_PRESS) {
        moveForward(cam, step);
    }
    if (glfwGetKey(window, GLFW_KEY_S) == GLFW_PRESS) {
        moveForward(cam, -step);
    }
    if (glfwGetKey(window, GLFW_KEY_A) == GLFW_PRESS) {
        moveRight(cam, -step);
    }
    if (glfwGetKey(window, GLFW_KEY_D) == GLFW_PRESS) {
        moveRight(cam, step);
    }
    if (glfwGetKey(window, GLFW_KEY_Q) == GLFW_PRESS) {
        cam->y -= step;
    }
    if (glfwGetKey(window, GLFW_KEY_E) == GLFW_PRESS) {
        cam->y += step;
    }
}

void updateMouseLook(GLFWwindow* window, CameraState* cam) {
    static bool wasDown = false;
    static double lastX = 0.0;
    static double lastY = 0.0;

    const bool down = glfwGetMouseButton(window, GLFW_MOUSE_BUTTON_RIGHT) == GLFW_PRESS;
    if (!down) {
        wasDown = false;
        glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_NORMAL);
        return;
    }

    glfwSetInputMode(window, GLFW_CURSOR, GLFW_CURSOR_DISABLED);
    double x = 0.0;
    double y = 0.0;
    glfwGetCursorPos(window, &x, &y);

    if (!wasDown) {
        lastX = x;
        lastY = y;
        wasDown = true;
        return;
    }

    const float dx = static_cast<float>(x - lastX);
    const float dy = static_cast<float>(y - lastY);
    lastX = x;
    lastY = y;

    const float sensitivity = 0.12f;
    cam->yaw += dx * sensitivity;
    cam->pitch = clampf(cam->pitch - dy * sensitivity, -89.0f, 89.0f);
}

void setTitle(GLFWwindow* window, const CameraState& cam, float fps) {
    char title[256];
    std::snprintf(
        title,
        sizeof(title),
        "rs_native_viewer | fps %.1f | cam (%.1f, %.1f, %.1f) yaw %.1f pitch %.1f",
        fps,
        cam.x,
        cam.y,
        cam.z,
        cam.yaw,
        cam.pitch);
    glfwSetWindowTitle(window, title);
}

} // namespace

int main() {
    if (glfwInit() != GLFW_TRUE) {
        std::fprintf(stderr, "rs_native_viewer: glfwInit failed\n");
        return 1;
    }

    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 2);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 1);
    glfwWindowHint(GLFW_SAMPLES, 4);

    GLFWwindow* window = glfwCreateWindow(1440, 900, "rs_native_viewer", nullptr, nullptr);
    if (!window) {
        std::fprintf(stderr, "rs_native_viewer: glfwCreateWindow failed\n");
        glfwTerminate();
        return 1;
    }

    glfwMakeContextCurrent(window);
    glfwSwapInterval(1);

    CameraState camera{};
    double lastTime = glfwGetTime();
    double lastFpsSample = lastTime;
    int frameCount = 0;
    float fps = 0.0f;

    while (glfwWindowShouldClose(window) == GLFW_FALSE) {
        const double now = glfwGetTime();
        float dt = static_cast<float>(now - lastTime);
        lastTime = now;
        if (dt < 0.0f) {
            dt = 0.0f;
        }
        if (dt > 0.2f) {
            dt = 0.2f;
        }

        glfwPollEvents();
        if (glfwGetKey(window, GLFW_KEY_ESCAPE) == GLFW_PRESS) {
            glfwSetWindowShouldClose(window, GLFW_TRUE);
        }

        updateMouseLook(window, &camera);
        updateCamera(window, &camera, dt);

        frameCount++;
        if (now - lastFpsSample >= 0.25) {
            fps = static_cast<float>(frameCount / (now - lastFpsSample));
            frameCount = 0;
            lastFpsSample = now;
            setTitle(window, camera, fps);
        }

        int fbWidth = 0;
        int fbHeight = 0;
        glfwGetFramebufferSize(window, &fbWidth, &fbHeight);
        glViewport(0, 0, fbWidth, fbHeight);
        glClearColor(0.04f, 0.05f, 0.08f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

        glfwSwapBuffers(window);
    }

    glfwDestroyWindow(window);
    glfwTerminate();
    return 0;
}
