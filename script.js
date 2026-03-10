let selectedCloth = null;
let selectedCategory = null;
let previewObjectUrl = null;

document.addEventListener("DOMContentLoaded", () => {
    renderAllProducts();
    setupPhotoPreview();
    setupTryOnButton();
});

function renderAllProducts() {
    createProducts("tops", "tops-container");
    createProducts("bottoms", "bottoms-container");
    createProducts("outerwears", "outerwears-container");
}

function createProducts(category, containerId) {
    const container = document.getElementById(containerId);

    if (!container) {
        console.error(`Контейнер "${containerId}" не найден`);
        return;
    }

    if (!products || !products[category] || !Array.isArray(products[category])) {
        console.error(`Категория "${category}" отсутствует в products.js`);
        return;
    }

    container.innerHTML = "";

    products[category].forEach((imgPath) => {
        const card = document.createElement("div");
        card.className = "product-card";
        card.dataset.category = category;
        card.dataset.path = imgPath;

        const img = document.createElement("img");
        img.src = imgPath;
        img.alt = getProductName(imgPath);

        const name = document.createElement("h3");
        name.textContent = formatProductTitle(imgPath);

        const price = document.createElement("p");
        price.textContent = "Цена: 9990₽";

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Выбрать";

        button.addEventListener("click", () => {
            selectSingleCloth(category, {
                path: imgPath,
                name: formatProductTitle(imgPath)
            });
        });

        card.appendChild(img);
        card.appendChild(name);
        card.appendChild(price);
        card.appendChild(button);

        container.appendChild(card);
    });
}

function selectSingleCloth(category, item) {
    document.querySelectorAll(".product-card").forEach((card) => {
        card.classList.remove("selected");
    });

    document.querySelectorAll(".product-card button").forEach((btn) => {
        btn.classList.remove("active");
        btn.textContent = "Выбрать";
    });

    const selectedCard = document.querySelector(
        `.product-card[data-category="${category}"][data-path="${item.path}"]`
    );

    if (selectedCard) {
        selectedCard.classList.add("selected");
        const button = selectedCard.querySelector("button");
        if (button) {
            button.classList.add("active");
            button.textContent = "Выбрано";
        }
    }

    selectedCloth = item;
    selectedCategory = category;

    updateSelectedClothText();
    setStatus("Одна вещь выбрана. Теперь загрузите фото и нажмите «Примерить».", false);
}

function updateSelectedClothText() {
    const selectedClothName = document.getElementById("selected-cloth-name");
    if (!selectedClothName) return;

    if (!selectedCloth) {
        selectedClothName.textContent = "Одежда ещё не выбрана";
        return;
    }

    const categoryLabel =
        selectedCategory === "tops"
            ? "Верх"
            : selectedCategory === "bottoms"
            ? "Низ"
            : "Верхняя одежда";

    selectedClothName.innerHTML = `${categoryLabel}: ${selectedCloth.name}`;
}

function setupPhotoPreview() {
    const fileInput = document.getElementById("user-photo");
    const previewWrapper = document.getElementById("preview-wrapper");
    const previewImg = document.getElementById("user-preview");

    if (!fileInput || !previewWrapper || !previewImg) return;

    fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];

        if (!file) {
            previewWrapper.hidden = true;

            if (previewObjectUrl) {
                URL.revokeObjectURL(previewObjectUrl);
                previewObjectUrl = null;
            }
            return;
        }

        if (!file.type.startsWith("image/")) {
            alert("Нужно выбрать именно изображение");
            fileInput.value = "";
            previewWrapper.hidden = true;
            return;
        }

        if (previewObjectUrl) {
            URL.revokeObjectURL(previewObjectUrl);
        }

        previewObjectUrl = URL.createObjectURL(file);
        previewImg.src = previewObjectUrl;
        previewWrapper.hidden = false;

        setStatus("Фото загружено.", false);
    });
}

function setupTryOnButton() {
    const tryOnBtn = document.getElementById("tryon-btn");

    if (!tryOnBtn) {
        console.error("Кнопка tryon-btn не найдена");
        return;
    }

    tryOnBtn.addEventListener("click", handleTryOn);
}

async function handleTryOn() {
    const fileInput = document.getElementById("user-photo");
    const resultDiv = document.getElementById("result");
    const tryOnBtn = document.getElementById("tryon-btn");

    if (!fileInput || !resultDiv || !tryOnBtn) {
        alert("Ошибка интерфейса: не найдены нужные элементы страницы");
        return;
    }

    const userFile = fileInput.files?.[0];

    if (!userFile) {
        alert("Выберите фото для примерки");
        return;
    }

    if (!selectedCloth) {
        alert("Сначала выберите одну вещь из каталога");
        return;
    }

    resultDiv.innerHTML = "";
    setStatus("Отправляем данные на сервер...", false);
    tryOnBtn.disabled = true;
    tryOnBtn.textContent = "Идёт примерка...";

    try {
        const formData = new FormData();
        formData.append("userPhoto", userFile);
        formData.append("clothPath", selectedCloth.path);
        formData.append("clothName", selectedCloth.name);
        formData.append("clothCategory", selectedCategory);

        const response = await fetch("/api/tryon", {
            method: "POST",
            body: formData
        });

        const data = await response.json();
        console.log("Ответ /api/tryon:", data);

        if (!response.ok || !data.success) {
            throw new Error(data?.error || "Примерка не удалась");
        }

        if (data.resultImageUrl) {
            resultDiv.innerHTML = `<img src="${data.resultImageUrl}" alt="Результат примерки">`;
        }

        setStatus(data.message || "Запрос успешно обработан.", false);
    } catch (error) {
        console.error("Ошибка примерки:", error);
        setStatus(`Ошибка: ${error.message}`, true);
        alert(`Не удалось примерить одежду: ${error.message}`);
    } finally {
        tryOnBtn.disabled = false;
        tryOnBtn.textContent = "Примерить выбранную одежду";
    }
}

function getProductName(path) {
    return path.split("/").pop().replace(/\.[^/.]+$/, "");
}

function formatProductTitle(path) {
    const fileName = getProductName(path);
    return fileName
        .replaceAll("_", " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function setStatus(message, isError = false) {
    const status = document.getElementById("status");
    if (!status) return;

    status.innerHTML = message;
    status.style.color = isError ? "#ff8a8a" : "#dddddd";
}